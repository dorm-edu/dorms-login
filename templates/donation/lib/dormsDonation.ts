import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { beginDormsLogin, callbackUrl, getDormsUser, safeDormsNext, SESSION_COOKIE } from "./dormsLogin";

const API = process.env.NODE_ENV !== "production" && /^https?:\/\/localhost(:\d+)?$/.test(process.env.DORMS_API_ORIGIN_DEV ?? "") ? process.env.DORMS_API_ORIGIN_DEV! : "https://dorms.school";
export const DONATION_COOKIE = "dorms_donation";
export const DONATION_FLOW_COOKIE = "dorms_donation_flow";
/** Separate PKCE verifier for the donation code that comes back with a DoRms login (v0.5.0). */
export const DONATION_LOGIN_FLOW_COOKIE = "dorms_donation_login_flow";
const BASE = "/api/auth/dorms/donation";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digest = (value: string) => createHash("sha256").update(value).digest("base64url");
const random = () => randomBytes(32).toString("base64url");
const now = () => Math.floor(Date.now() / 1000);
export class DormsDonationError extends Error {
  constructor(readonly reason: string, readonly status = 503) { super(reason); this.name = "DormsDonationError"; }
}
/** dailyRemaining: 이번에 보낼 수 있는 최대(0~3). dailyRemainingTotal: 오늘 모든 연동 앱을 합쳐 남은 양(하루 15도름, v0.6.0~). */
export type DonationStatus = { subject: string; availableBalance: number; dailyRemaining: number; dailyRemainingTotal?: number; resetsAt: string };
export type DonationResult = Omit<DonationStatus, "subject"> & { transferId: string; amount: number };
type Flow = { state: string; verifier: string; next: string; createdAt: number; subject: string; session: string };
type Credential = { token: string; session: string; expiresAt: number };
type LoginFlow = { state: string; verifier: string; createdAt: number };
export const donationCookieOptions = (maxAge: number) => ({ httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: Math.max(0, Math.floor(maxAge)) });
export const donationStartHref = (next = "/") => `${BASE}/start?next=${encodeURIComponent(safeDormsNext(next))}`;
/**
 * How this site asks for donation permission, chosen at install time (v0.5.0):
 * `init/upgrade --donations` = "separate" (normal login, permission on the first send),
 * `init/upgrade --donations-at-login` = "at-login" (every DoRms login of this site also asks for donation permission,
 * so sends never leave the page while the login lasts). The installer writes the value below; change it with upgrade.
 */
const DONATION_MODE: string = "__DORMS_DONATION_MODE__";
export const DONATION_AT_LOGIN = DONATION_MODE === "at-login";
function decode<T>(value: string | undefined): T | null {
  if (!value || value.length > 3500 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try { return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T; } catch { return null; }
}
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
async function session() {
  const user = await getDormsUser();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!user || !token) throw new DormsDonationError("authentication_required", 401);
  return { user, hash: digest(token), loginToken: token };
}
function callback(requestUrl: string) { return new URL(`${BASE}/callback`, callbackUrl(requestUrl)).toString(); }
async function request(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(`${API}/api/connect/donations/${path}`, { ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8000) });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new DormsDonationError(typeof body?.reason === "string" && /^[a-z_]{1,80}$/.test(body.reason) ? body.reason : "temporarily_unavailable", response.status);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new DormsDonationError("temporarily_unavailable");
    return body;
  } catch (error) { if (error instanceof DormsDonationError) throw error; throw new DormsDonationError("temporarily_unavailable"); }
}
export async function beginDonation(requestUrl: string, next?: string | null) {
  const current = await session();
  const flow: Flow = { state: random(), verifier: random(), next: safeDormsNext(next), createdAt: now(), subject: current.user.id, session: current.hash };
  const url = new URL(`${API}/api/connect/donations/authorize`);
  for (const [key, value] of Object.entries({ client_id: process.env.DORMS_CLIENT_ID!, redirect_uri: callback(requestUrl), state: flow.state, code_challenge: digest(flow.verifier), code_challenge_method: "S256", session_expires_at: String(current.user.expiresAt) })) url.searchParams.set(key, value);
  return { authorizeUrl: url.toString(), flow: encode(flow) };
}
export async function finishDonation(requestUrl: string, code: string | null, state: string | null, value: string | undefined, upstreamError?: string | null) {
  const flow = decode<Flow>(value);
  const current = await session();
  if (!flow || !state || state !== flow.state || !/^[A-Za-z0-9_-]{43}$/.test(flow.verifier) || flow.session !== current.hash || flow.subject !== current.user.id || !Number.isInteger(flow.createdAt) || flow.createdAt > now() + 30 || now() - flow.createdAt > 600) throw new DormsDonationError("authentication_required", 401);
  if (upstreamError) throw new DormsDonationError(/^[a-z_]{1,80}$/.test(upstreamError) ? upstreamError : "access_denied", upstreamError === "temporarily_unavailable" ? 503 : 403);
  if (!code || code.length > 2048) throw new DormsDonationError("authentication_required", 401);
  const pass = await exchangeDonationCode({ requestUrl, loginToken: current.loginToken, subject: current.user.id, loginExpiresAt: current.user.expiresAt, code, verifier: flow.verifier });
  return { ...pass, next: safeDormsNext(flow.next) };
}
/** Trade a donation code for the server-only donation token, bound to this exact login token. */
async function exchangeDonationCode(input: { requestUrl: string; loginToken: string; subject: string; loginExpiresAt: number; code: string; verifier: string }) {
  const body = await request("token", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${input.loginToken}` }, body: JSON.stringify({ client_id: process.env.DORMS_CLIENT_ID, redirect_uri: callback(input.requestUrl), code: input.code, code_verifier: input.verifier }) });
  if (body.subject !== input.subject || typeof body.donation_token !== "string" || body.donation_token.length < 32 || body.donation_token.length > 1024 || typeof body.expires_in !== "number" || !Number.isInteger(body.expires_in) || body.expires_in <= 0) throw new DormsDonationError("temporarily_unavailable");
  const expiresAt = Math.min(now() + body.expires_in, now() + 604800, input.loginExpiresAt);
  if (expiresAt <= now()) throw new DormsDonationError("authentication_required", 401);
  return { value: encode({ token: body.donation_token, session: digest(input.loginToken), expiresAt }), maxAge: expiresAt - now() };
}
/**
 * Start a DoRms login that also requests donation permission (v0.5.0). Only an approved site asks for it, and only when
 * DoRms says it accepts donation permission at login (an older or rolled-back DoRms gets a normal login, never a broken one).
 * Otherwise this is the normal login and `donationFlow` is null. The donation verifier differs from the login verifier.
 */
export async function beginDonationLogin(requestUrl: string, next?: string | null) {
  const login = await beginDormsLogin(requestUrl, next);
  if (login.donations !== "approved" || !login.donationsAtLogin) return { authorizeUrl: login.authorizeUrl, cookie: login.cookie, donationFlow: null as string | null };
  const url = new URL(login.authorizeUrl);
  const state = url.searchParams.get("state");
  if (!state) return { authorizeUrl: login.authorizeUrl, cookie: login.cookie, donationFlow: null as string | null };
  const flow: LoginFlow = { state, verifier: random(), createdAt: now() };
  url.searchParams.set("scope", `${url.searchParams.get("scope") ?? "openid profile"} donation`);
  url.searchParams.set("donation_code_challenge", digest(flow.verifier));
  return { authorizeUrl: url.toString(), cookie: login.cookie, donationFlow: encode(flow) as string | null };
}
/**
 * In the login callback, right after finishDormsLogin: turn the returned donation code into the donation cookie value.
 * The login must still succeed when this throws; the donation button then asks for permission the usual way.
 */
export async function finishDonationLogin(requestUrl: string, input: { idToken: string; subject: string; expiresAt: number; state: string | null; code: string | null; flow: string | undefined }) {
  const flow = decode<LoginFlow>(input.flow);
  if (!flow || !input.state || flow.state !== input.state || !/^[A-Za-z0-9_-]{43}$/.test(flow.verifier) || !Number.isInteger(flow.createdAt) || flow.createdAt > now() + 30 || now() - flow.createdAt > 600) throw new DormsDonationError("authentication_required", 401);
  if (!input.code || !/^[A-Za-z0-9_-]{43}$/.test(input.code)) throw new DormsDonationError("consent_required", 403);
  return exchangeDonationCode({ requestUrl, loginToken: input.idToken, subject: input.subject, loginExpiresAt: input.expiresAt, code: input.code, verifier: flow.verifier });
}
async function credential() {
  const current = await session();
  const saved = decode<Credential>((await cookies()).get(DONATION_COOKIE)?.value);
  if (!saved || saved.session !== current.hash || !Number.isInteger(saved.expiresAt) || saved.expiresAt <= now() || typeof saved.token !== "string" || saved.token.length < 32 || saved.token.length > 1024) throw new DormsDonationError("consent_required", 403);
  return { token: saved.token, subject: current.user.id };
}
function balances(body: Record<string, unknown>) {
  if (typeof body.availableBalance !== "number" || !Number.isFinite(body.availableBalance) || body.availableBalance < 0 || !Number.isInteger(body.dailyRemaining) || Number(body.dailyRemaining) < 0 || Number(body.dailyRemaining) > 3 || (body.dailyRemainingTotal !== undefined && (!Number.isInteger(body.dailyRemainingTotal) || Number(body.dailyRemainingTotal) < Number(body.dailyRemaining) || Number(body.dailyRemainingTotal) > 1000)) || typeof body.resetsAt !== "string" || !Number.isFinite(Date.parse(body.resetsAt))) throw new DormsDonationError("temporarily_unavailable");
}
export async function getDonationStatus(): Promise<DonationStatus> {
  const current = await credential();
  const body = await request("status", { headers: { Authorization: `Bearer ${current.token}` } });
  balances(body);
  if (body.subject !== current.subject) throw new DormsDonationError("authentication_required", 401);
  return body as DonationStatus;
}
/** Cookie-authenticated mutations require a same-origin POST, even from custom route handlers/server actions. */
export async function assertDonationOrigin() {
  const h = await headers();
  const expected = process.env.DORMS_SITE_URL;
  const origin = h.get("origin");
  const site = h.get("sec-fetch-site");
  const local = process.env.NODE_ENV !== "production" && /^http:\/\/localhost(:\d+)?$/.test(origin ?? "");
  if ((!local && origin !== expected?.replace(/\/$/, "")) || !origin || (site && site !== "same-origin" && site !== "none")) throw new DormsDonationError("forbidden", 403);
}
export async function sendDonation(input: { recipientId: string; amount: number; requestId: string }): Promise<DonationResult> {
  await assertDonationOrigin();
  if (!UUID.test(input.recipientId) || !Number.isInteger(input.amount) || input.amount < 1 || input.amount > 3 || !UUID.test(input.requestId)) throw new DormsDonationError("invalid_request", 400);
  const current = await credential();
  const body = await request("send", { method: "POST", headers: { Authorization: `Bearer ${current.token}`, "Content-Type": "application/json" }, body: JSON.stringify(input) });
  balances(body);
  if (typeof body.transferId !== "string" || !UUID.test(body.transferId) || body.amount !== input.amount) throw new DormsDonationError("temporarily_unavailable");
  return body as DonationResult;
}
export async function revokeDonation() {
  const saved = decode<Credential>((await cookies()).get(DONATION_COOKIE)?.value);
  if (saved && typeof saved.token === "string" && saved.token.length >= 32 && saved.token.length <= 1024) await request("revoke", { method: "POST", headers: { Authorization: `Bearer ${saved.token}` } });
}
