import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { callbackUrl, getDormsUser, safeDormsNext, SESSION_COOKIE } from "./dormsLogin";

const API = process.env.NODE_ENV !== "production" && /^https?:\/\/localhost(:\d+)?$/.test(process.env.DORMS_API_ORIGIN_DEV ?? "") ? process.env.DORMS_API_ORIGIN_DEV! : "https://dorms.school";
export const DONATION_COOKIE = "dorms_donation";
export const DONATION_FLOW_COOKIE = "dorms_donation_flow";
const BASE = "/api/auth/dorms/donation";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digest = (value: string) => createHash("sha256").update(value).digest("base64url");
const random = () => randomBytes(32).toString("base64url");
const now = () => Math.floor(Date.now() / 1000);
export class DormsDonationError extends Error {
  constructor(readonly reason: string, readonly status = 503) { super(reason); this.name = "DormsDonationError"; }
}
export type DonationStatus = { subject: string; availableBalance: number; dailyRemaining: number; resetsAt: string };
export type DonationResult = Omit<DonationStatus, "subject"> & { transferId: string; amount: number };
type Flow = { state: string; verifier: string; next: string; createdAt: number; subject: string; session: string };
type Credential = { token: string; session: string; expiresAt: number };
export const donationCookieOptions = (maxAge: number) => ({ httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: Math.max(0, Math.floor(maxAge)) });
export const donationStartHref = (next = "/") => `${BASE}/start?next=${encodeURIComponent(safeDormsNext(next))}`;
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
  const body = await request("token", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${current.loginToken}` }, body: JSON.stringify({ client_id: process.env.DORMS_CLIENT_ID, redirect_uri: callback(requestUrl), code, code_verifier: flow.verifier }) });
  if (body.subject !== current.user.id || typeof body.donation_token !== "string" || body.donation_token.length < 32 || body.donation_token.length > 1024 || typeof body.expires_in !== "number" || !Number.isInteger(body.expires_in) || body.expires_in <= 0) throw new DormsDonationError("temporarily_unavailable");
  const expiresAt = Math.min(now() + body.expires_in, now() + 604800, current.user.expiresAt);
  return { value: encode({ token: body.donation_token, session: current.hash, expiresAt }), maxAge: expiresAt - now(), next: safeDormsNext(flow.next) };
}
async function credential() {
  const current = await session();
  const saved = decode<Credential>((await cookies()).get(DONATION_COOKIE)?.value);
  if (!saved || saved.session !== current.hash || !Number.isInteger(saved.expiresAt) || saved.expiresAt <= now() || typeof saved.token !== "string" || saved.token.length < 32 || saved.token.length > 1024) throw new DormsDonationError("consent_required", 403);
  return { token: saved.token, subject: current.user.id };
}
function balances(body: Record<string, unknown>) {
  if (typeof body.availableBalance !== "number" || !Number.isFinite(body.availableBalance) || body.availableBalance < 0 || !Number.isInteger(body.dailyRemaining) || Number(body.dailyRemaining) < 0 || Number(body.dailyRemaining) > 3 || typeof body.resetsAt !== "string" || !Number.isFinite(Date.parse(body.resetsAt))) throw new DormsDonationError("temporarily_unavailable");
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
