/**
 * DoRms login v0.5.0. Server components, route handlers and server actions only.
 * Every protected call verifies the token and asks DoRms for current permission.
 * Do not cache the result across requests or continue with an old user on failure.
 */
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

export const DORMS_ISSUER = "https://dorms.school";
const API_ORIGIN = process.env.NODE_ENV !== "production" && /^https?:\/\/localhost(:\d+)?$/.test(process.env.DORMS_API_ORIGIN_DEV ?? "") ? process.env.DORMS_API_ORIGIN_DEV! : DORMS_ISSUER;
export const DORMS_AUTHORIZE_URL = `${API_ORIGIN}/api/sso/authorize`;
export const DORMS_TOKEN_URL = `${API_ORIGIN}/api/sso/token`;
export const DORMS_USERINFO_URL = `${API_ORIGIN}/api/sso/userinfo`;
export const DORMS_JWKS_URL = `${API_ORIGIN}/api/sso/jwks`;
export const DORMS_CALLBACK_PATH = "/api/auth/dorms/callback";
export const SESSION_COOKIE = "dorms_session";
export const FLOW_COOKIE = "dorms_flow";
const FLOW_TTL_SECONDS = 600;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type DormsFailureReason = "authentication_required" | "access_denied" | "temporarily_unavailable";
export class DormsAuthError extends Error {
  readonly status: 401 | 403 | 503;
  constructor(readonly reason: DormsFailureReason) {
    super(reason === "authentication_required" ? "도름스 로그인이 필요해요." : reason === "access_denied" ? "이 사이트에 들어갈 수 없어요. 도름스에서 허용 상태와 입장 조건을 확인해 주세요." : "도름스에서 허용 상태를 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
    this.name = "DormsAuthError";
    this.status = reason === "authentication_required" ? 401 : reason === "access_denied" ? 403 : 503;
  }
}

export type DormsUser = {
  /** Stable DoRms member ID. Never merge accounts by email. */
  id: string;
  name: string | null;
  handle: string | null;
  picture: string | null;
  teacherVerified: boolean;
  dorms: number;
  email: string | null;
  expiresAt: number;
};
export type DormsPolicy = { requireTeacher?: boolean; minDorms?: number };
type LoginFlow = { version: 2; state: string; verifier: string; nonce: string; next: string; createdAt: number };

function clientId(): string {
  const value = process.env.DORMS_CLIENT_ID?.trim() ?? "";
  if (!UUID.test(value)) throw new DormsAuthError("temporarily_unavailable");
  return value;
}

function siteUrl(): string {
  const value = process.env.DORMS_SITE_URL?.trim() ?? "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("origin only");
    return url.origin;
  } catch { throw new DormsAuthError("temporarily_unavailable"); }
}

export function callbackUrl(requestUrl: string): string {
  const origin = new URL(requestUrl).origin;
  const local = process.env.NODE_ENV !== "production" && /^http:\/\/localhost(:\d+)?$/.test(origin);
  return `${local ? origin : siteUrl()}${DORMS_CALLBACK_PATH}`;
}

const jwks = createRemoteJWKSet(new URL(DORMS_JWKS_URL), { cacheMaxAge: 3_600_000 });
const random = () => randomBytes(32).toString("base64url");

/** Only a same-origin path, including after URL normalization. */
export function safeDormsNext(raw: string | null | undefined): string {
  if (!raw || raw.length > 512 || !raw.startsWith("/") || raw.startsWith("//") || /[\u0000-\u0020\u007f\\]/.test(raw)) return "/";
  try {
    const url = new URL(raw, "https://dorms-login.invalid");
    if (url.origin !== "https://dorms-login.invalid" || url.pathname.startsWith("//")) return "/";
    const next = `${url.pathname}${url.search}${url.hash}`;
    return next.length <= 512 ? next : "/";
  } catch { return "/"; }
}

function failure(status: number, body: Record<string, unknown>, fallback: DormsFailureReason): DormsAuthError {
  if (status === 429 || status >= 500 || body.reason === "temporarily_unavailable") return new DormsAuthError("temporarily_unavailable");
  if (body.reason === "access_denied" || status === 403) return new DormsAuthError("access_denied");
  if (body.reason === "authentication_required" || status === 401) return new DormsAuthError("authentication_required");
  return new DormsAuthError(fallback);
}

async function requestJson(url: string, init: RequestInit = {}, fallback: DormsFailureReason = "access_denied"): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(url, { ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8_000) });
    const body: unknown = await response.json().catch(() => null);
    const object = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
    if (!response.ok) throw failure(response.status, object, fallback);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new DormsAuthError("temporarily_unavailable");
    return object;
  } catch (error) {
    if (error instanceof DormsAuthError) throw error;
    throw new DormsAuthError("temporarily_unavailable");
  }
}

/**
 * `donations` is the site's DoRms donation approval ("approved", "pending", "none", ...) and `donationsAtLogin` says whether
 * DoRms accepts donation permission inside the login request. The optional donation add-on reads both.
 */
export async function beginDormsLogin(requestUrl: string, next?: string | null): Promise<{ authorizeUrl: string; cookie: { name: string; value: string; maxAge: number }; donations: string | null; donationsAtLogin: boolean }> {
  const id = clientId();
  const callback = callbackUrl(requestUrl);
  const configUrl = new URL(`${API_ORIGIN}/api/sso/clients/${encodeURIComponent(id)}/configuration`);
  configUrl.searchParams.set("redirect_uri", callback);
  const config = await requestJson(configUrl.toString());
  if (config.active !== true) throw new DormsAuthError("access_denied");
  if (!Array.isArray(config.scopes) || !config.scopes.includes("openid") || !config.scopes.includes("profile") || !config.scopes.every((s) => ["openid", "profile", "email"].includes(String(s)))) throw new DormsAuthError("temporarily_unavailable");
  // The Doreumi outfit is a separate opt-in flag so older installations keep working; ask for it only when DoRms says the site enabled it.
  const scopes = [...new Set(config.scopes.map(String)), ...(config.doreumi === true ? ["doreumi"] : [])];
  const flow: LoginFlow = { version: 2, state: random(), verifier: random(), nonce: random(), next: safeDormsNext(next), createdAt: Math.floor(Date.now() / 1000) };
  const url = new URL(DORMS_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", id);
  url.searchParams.set("redirect_uri", callback);
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("state", flow.state);
  url.searchParams.set("nonce", flow.nonce);
  url.searchParams.set("code_challenge", createHash("sha256").update(flow.verifier, "ascii").digest("base64url"));
  url.searchParams.set("code_challenge_method", "S256");
  const donations = config.donations && typeof config.donations === "object" && typeof (config.donations as { status?: unknown }).status === "string" ? String((config.donations as { status: string }).status) : null;
  const donationsAtLogin = !!config.donations && typeof config.donations === "object" && (config.donations as { atLogin?: unknown }).atLogin === true;
  return { authorizeUrl: url.toString(), cookie: { name: FLOW_COOKIE, value: Buffer.from(JSON.stringify(flow)).toString("base64url"), maxAge: FLOW_TTL_SECONDS }, donations, donationsAtLogin };
}

export function parseFlowCookie(value: string | undefined): LoginFlow | null {
  if (!value || value.length > 3500 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") !== value) return null;
    const flow = JSON.parse(bytes.toString("utf8")) as LoginFlow;
    if (!flow || flow.version !== 2 || ![flow.state, flow.verifier, flow.nonce].every((part) => typeof part === "string" && /^[A-Za-z0-9_-]{43}$/.test(part))) return null;
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isInteger(flow.createdAt) || flow.createdAt > now + 30 || now - flow.createdAt > FLOW_TTL_SECONDS || typeof flow.next !== "string" || flow.next.length > 512) return null;
    return { ...flow, next: safeDormsNext(flow.next) };
  } catch { return null; }
}

async function verifyIdToken(token: string): Promise<JWTPayload> {
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: DORMS_ISSUER, audience: clientId(), algorithms: ["EdDSA"], requiredClaims: ["sub", "iat", "exp", "jti", "grant_version"] });
    if (!UUID.test(String(payload.sub)) || !UUID.test(String(payload.grant_version))) throw new DormsAuthError("authentication_required");
    return payload;
  } catch (error) {
    if (error instanceof DormsAuthError) throw error;
    const code = (error as { code?: string })?.code ?? "";
    if (["ERR_JWT_EXPIRED", "ERR_JWT_CLAIM_VALIDATION_FAILED", "ERR_JWS_SIGNATURE_VERIFICATION_FAILED", "ERR_JWS_INVALID", "ERR_JWT_INVALID", "ERR_JOSE_ALG_NOT_ALLOWED", "ERR_JWKS_NO_MATCHING_KEY"].includes(code)) throw new DormsAuthError("authentication_required");
    throw new DormsAuthError("temporarily_unavailable");
  }
}

export async function finishDormsLogin(input: { code: string; verifier: string; nonce: string; requestUrl: string }): Promise<{ idToken: string; expiresAt: number; subject: string }> {
  const body = await requestJson(DORMS_TOKEN_URL, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ grant_type: "authorization_code", code: input.code, code_verifier: input.verifier, client_id: clientId(), redirect_uri: callbackUrl(input.requestUrl) }),
  }, "authentication_required");
  if (typeof body.id_token !== "string" || body.id_token.length > 3800) throw new DormsAuthError("temporarily_unavailable");
  const payload = await verifyIdToken(body.id_token);
  if (payload.nonce !== input.nonce) throw new DormsAuthError("authentication_required");
  return { idToken: body.id_token, expiresAt: Number(payload.exp), subject: String(payload.sub) };
}

async function currentUser(token: string): Promise<DormsUser> {
  const payload = await verifyIdToken(token);
  const body = await requestJson(DORMS_USERINFO_URL, { headers: { Authorization: `Bearer ${token}` } }, "authentication_required");
  if (body.sub !== payload.sub || typeof body.teacher_verified !== "boolean" || typeof body.dorms !== "number" || !Number.isFinite(body.dorms) || body.dorms < 0) throw new DormsAuthError("temporarily_unavailable");
  return {
    id: String(body.sub), name: typeof body.name === "string" ? body.name : null,
    handle: typeof body.handle === "string" ? body.handle : null, picture: typeof body.picture === "string" ? body.picture : null,
    teacherVerified: body.teacher_verified, dorms: body.dorms, email: typeof body.email === "string" ? body.email : null, expiresAt: Number(payload.exp),
  };
}

/** Missing/expired/legacy session: null. Revoked permission: 403 error. Outage: 503 error. Never fall back to old claims. */
export async function getDormsUser(): Promise<DormsUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try { return await currentUser(token); }
  catch (error) {
    if (error instanceof DormsAuthError && error.reason === "authentication_required") return null;
    throw error;
  }
}

/** Optional extra restrictions owned by this site. The current DoRms policy was already enforced by userinfo. */
export function meetsDormsPolicy(user: DormsUser, policy: DormsPolicy = {}): boolean {
  return (!policy.requireTeacher || user.teacherVerified) && (policy.minDorms === undefined || (Number.isFinite(policy.minDorms) && policy.minDorms >= 0 && user.dorms >= policy.minDorms));
}

/** Page guard. Only a missing/expired session starts login automatically; denial and outages show a stable explanation. */
export async function requireDormsUser(options: { next?: string } & DormsPolicy = {}): Promise<DormsUser> {
  let user: DormsUser | null;
  try { user = await getDormsUser(); }
  catch (error) {
    if (!(error instanceof DormsAuthError)) throw error;
    redirect(`/dorms-denied?reason=${error.reason}&next=${encodeURIComponent(safeDormsNext(options.next))}`);
  }
  if (!user) redirect(dormsLoginHref(options.next));
  if (!meetsDormsPolicy(user, options)) redirect(`/dorms-denied?reason=access_denied&next=${encodeURIComponent(safeDormsNext(options.next))}`);
  return user;
}

/** Same freshness and error contract as getDormsUser(). Kept for existing integrations. */
export async function refreshDormsUser(): Promise<DormsUser | null> { return getDormsUser(); }

export function sessionCookieOptions(maxAgeSeconds: number) {
  return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: Math.max(0, Math.floor(maxAgeSeconds)) };
}
export const dormsLoginHref = (next = "/") => `/api/auth/dorms/start?next=${encodeURIComponent(safeDormsNext(next))}`;
export const dormsLogoutHref = "/api/auth/dorms/logout";
