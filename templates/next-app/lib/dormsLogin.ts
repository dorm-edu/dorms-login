/**
 * DoRms로 로그인 (dorms-login 템플릿, Next.js App Router 전용)
 *
 * 도름스(https://dorms.school)는 OAuth 2.1 인가코드 + PKCE 로 로그인을 내어 준다. 이 파일은 그 흐름의
 * 사이트 쪽 절반이다. 비밀값은 없다. 필요한 환경 변수는 DORMS_CLIENT_ID 와 DORMS_SITE_URL 둘뿐이다.
 *
 * 세션은 도름스가 서명한 id_token 을 httpOnly 쿠키에 그대로 담고, 매 요청 도름스 공개키(JWKS)로 서명·만료를
 * 확인한다. 회원이 도름스에서 연결을 끊거나 사이트 정책이 바뀌어도 만료 전 토큰은 남을 수 있으니,
 * 민감한 동작 전에는 refreshDormsUser() 로 지금 상태를 다시 물어본다.
 *
 * 생성: dorms-login init (정책·이메일 상수는 init 이 채운다)
 */
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createRemoteJWKSet, jwtVerify } from "jose";

export const DORMS_ISSUER = "https://dorms.school";
/** 개발용: 도름스를 로컬에서 띄워 시험할 때만 DORMS_API_ORIGIN_DEV 로 주소를 바꾼다(운영 빌드에서는 무시). */
const API_ORIGIN = process.env.NODE_ENV !== "production" && /^https?:\/\/localhost(:\d+)?$/.test(process.env.DORMS_API_ORIGIN_DEV ?? "") ? process.env.DORMS_API_ORIGIN_DEV! : DORMS_ISSUER;
export const DORMS_AUTHORIZE_URL = `${API_ORIGIN}/api/sso/authorize`;
export const DORMS_TOKEN_URL = `${API_ORIGIN}/api/sso/token`;
export const DORMS_USERINFO_URL = `${API_ORIGIN}/api/sso/userinfo`;
export const DORMS_JWKS_URL = `${API_ORIGIN}/api/sso/jwks`;
export const DORMS_CALLBACK_PATH = "/api/auth/dorms/callback";

/** 도름스 /connect 에서 정한 문(도름스가 로그인 순간에 강제한다). 여기 값은 사이트 안에서 한 번 더 확인하는 기본값. */
export const DORMS_POLICY = { requireTeacher: __DORMS_REQUIRE_TEACHER__, minDorms: __DORMS_MIN_DORMS__ } as const;
/** 도름스 /connect 에서 "이메일도 받기"를 켰는지. 켜도 회원이 허용해야만 이메일이 온다. */
export const DORMS_WANTS_EMAIL = __DORMS_WANTS_EMAIL__;

export const SESSION_COOKIE = "dorms_session";
const FLOW_COOKIE = "dorms_flow";
const FLOW_TTL_SECONDS = 600;

export type DormsUser = {
  /** 도름스 회원 id(uuid). 사람을 구분하는 기준은 이 값이다(이메일이 아니다). */
  id: string;
  name: string | null;
  handle: string | null;
  picture: string | null;
  teacherVerified: boolean;
  dorms: number;
  /** 도름스에서 이메일 전달을 켜고 회원이 허용한 경우에만 있다. 애플 이메일 가리기 계정은 없다. */
  email: string | null;
  /** 토큰 만료 시각(초). */
  expiresAt: number;
};

function clientId(): string {
  const value = process.env.DORMS_CLIENT_ID?.trim();
  if (!value) throw new Error("DORMS_CLIENT_ID 환경 변수가 없어요. 도름스 /connect 에서 받은 사이트 id 를 넣어 주세요.");
  return value;
}

function siteUrl(): string {
  const value = process.env.DORMS_SITE_URL?.trim().replace(/\/+$/, "");
  if (!value) throw new Error("DORMS_SITE_URL 환경 변수가 없어요. 배포 주소(https://...)를 넣어 주세요.");
  return value;
}

/** 로컬 개발(localhost)이면 그 origin 으로, 아니면 등록한 배포 주소로 되돌아온다(도름스에 둘 다 등록돼 있다). */
export function callbackUrl(requestUrl: string): string {
  const origin = new URL(requestUrl).origin;
  const isLocal = /^http:\/\/localhost(:\d+)?$/.test(origin);
  return `${isLocal ? origin : siteUrl()}${DORMS_CALLBACK_PATH}`;
}

const jwks = createRemoteJWKSet(new URL(DORMS_JWKS_URL), { cacheMaxAge: 3_600_000 });

function b64url(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** 로그인 뒤 돌아갈 곳은 이 사이트 안의 경로만. 제어문자·공백·역슬래시·프로토콜 상대 주소는 전부 버린다. */
function safeNext(raw: string | null | undefined): string {
  if (!raw || raw.length > 512 || !raw.startsWith("/") || raw.startsWith("//") || /[\u0000-\u0020\u007f\\]/.test(raw)) return "/";
  try {
    const base = "https://dorms-login.invalid";
    const url = new URL(raw, base);
    if (url.origin !== base || url.username || url.password) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

/** 로그인 시작: PKCE·state·nonce 를 만들어 임시 쿠키에 두고 도름스 authorize 주소를 돌려준다. */
export async function beginDormsLogin(requestUrl: string, next?: string | null): Promise<{ authorizeUrl: string; cookie: { name: string; value: string; maxAge: number } }> {
  const state = b64url();
  const verifier = b64url();
  const nonce = b64url();
  const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
  const url = new URL(DORMS_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId());
  url.searchParams.set("redirect_uri", callbackUrl(requestUrl));
  url.searchParams.set("scope", DORMS_WANTS_EMAIL ? "openid profile email" : "openid profile");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  const value = [state, verifier, nonce, encodeURIComponent(safeNext(next))].join(".");
  return { authorizeUrl: url.toString(), cookie: { name: FLOW_COOKIE, value, maxAge: FLOW_TTL_SECONDS } };
}

export function parseFlowCookie(value: string | undefined): { state: string; verifier: string; nonce: string; next: string } | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const [state, verifier, nonce, next] = parts;
  if (![state, verifier, nonce].every((p) => /^[A-Za-z0-9_-]{43}$/.test(p))) return null;
  return { state, verifier, nonce, next: safeNext(decodeURIComponent(next)) };
}

/** 인가코드를 토큰으로 바꾸고 id_token 서명·nonce 를 확인한다. 성공하면 id_token(세션에 담을 값)과 만료를 돌려준다. */
export async function finishDormsLogin(input: { code: string; verifier: string; nonce: string; requestUrl: string }): Promise<{ idToken: string; expiresAt: number }> {
  const response = await fetch(DORMS_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ grant_type: "authorization_code", code: input.code, code_verifier: input.verifier, client_id: clientId(), redirect_uri: callbackUrl(input.requestUrl) }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await response.json().catch(() => null)) as { id_token?: unknown; error?: string } | null;
  if (!response.ok || typeof body?.id_token !== "string") {
    throw new Error(`도름스 토큰 교환 실패: ${body?.error ?? response.status}`);
  }
  const { payload } = await jwtVerify(body.id_token, jwks, { issuer: DORMS_ISSUER, audience: clientId(), algorithms: ["EdDSA"], requiredClaims: ["sub", "iat", "exp", "jti"] });
  if (payload.nonce !== input.nonce) throw new Error("도름스 응답의 nonce 가 맞지 않아요.");
  return { idToken: body.id_token, expiresAt: Number(payload.exp) };
}

function toUser(payload: Record<string, unknown>): DormsUser {
  return {
    id: String(payload.sub),
    name: typeof payload.name === "string" ? payload.name : null,
    handle: typeof payload.handle === "string" ? payload.handle : null,
    picture: typeof payload.picture === "string" ? payload.picture : null,
    teacherVerified: payload.teacher_verified === true,
    dorms: typeof payload.dorms === "number" ? payload.dorms : 0,
    email: typeof payload.email === "string" ? payload.email : null,
    expiresAt: Number(payload.exp ?? 0),
  };
}

/** 지금 로그인한 도름스 회원. 없으면 null. 서버 컴포넌트·라우트 핸들러·서버 액션에서 쓴다. */
export async function getDormsUser(): Promise<DormsUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: DORMS_ISSUER, audience: clientId(), algorithms: ["EdDSA"], requiredClaims: ["sub", "iat", "exp", "jti"] });
    return toUser(payload as Record<string, unknown>);
  } catch {
    return null;
  }
}

export function meetsDormsPolicy(user: DormsUser, policy: { requireTeacher?: boolean; minDorms?: number } = DORMS_POLICY): boolean {
  if (policy.requireTeacher && !user.teacherVerified) return false;
  if ((policy.minDorms ?? 0) > user.dorms) return false;
  return true;
}

/**
 * 로그인이 필요한 화면에서 부른다. 로그인 전이면 도름스 로그인으로 보내고(끝나면 next 로 돌아옴),
 * 문(교사 인증·도름 수)에 안 맞으면 /dorms-denied 로 보낸다. 통과하면 회원을 돌려준다.
 */
export async function requireDormsUser(options: { next?: string; requireTeacher?: boolean; minDorms?: number } = {}): Promise<DormsUser> {
  const user = await getDormsUser();
  if (!user) redirect(`/api/auth/dorms/start?next=${encodeURIComponent(safeNext(options.next))}`);
  const policy = { requireTeacher: options.requireTeacher ?? DORMS_POLICY.requireTeacher, minDorms: options.minDorms ?? DORMS_POLICY.minDorms };
  if (!meetsDormsPolicy(user, policy)) redirect(`/dorms-denied?reason=${policy.requireTeacher && !user.teacherVerified ? "teacher" : "dorms"}`);
  return user;
}

/** 도름스에 지금 상태를 다시 묻는다(교사 인증·도름 수·연결 끊김·사이트 잠금이 즉시 반영). 실패하면 null. */
export async function refreshDormsUser(): Promise<DormsUser | null> {
  // 먼저 이 사이트용(aud=내 사이트 id) 토큰인지 서명까지 확인한다. 다른 사이트의 토큰을 쿠키에 넣어도 여기서 걸린다.
  const local = await getDormsUser();
  if (!local) return null;
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const response = await fetch(DORMS_USERINFO_URL, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return null;
    const body = (await response.json()) as Record<string, unknown>;
    if (body.sub !== local.id) return null;
    const fresh = toUser({ ...body, exp: local.expiresAt });
    return meetsDormsPolicy(fresh) ? fresh : null;
  } catch {
    return null;
  }
}

/** 세션 쿠키 옵션. 운영은 https 전용, 로컬(http://localhost)은 secure 를 끈다. */
export function sessionCookieOptions(maxAgeSeconds: number) {
  return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: Math.max(60, maxAgeSeconds) };
}

export const dormsLoginHref = (next = "/") => `/api/auth/dorms/start?next=${encodeURIComponent(safeNext(next))}`;
export const dormsLogoutHref = "/api/auth/dorms/logout";
