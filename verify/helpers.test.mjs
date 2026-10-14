import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as jose from "jose";

const require = createRequire(import.meta.url);
const CLIENT = "3b5f4d8c-7e2a-4c1b-9f0d-2a6e8c4b1d3e";
const MEMBER = "ab5f4d8c-7e2a-4c1b-9f0d-2a6e8c4b1d3e";
const GRANT = "bb5f4d8c-7e2a-4c1b-9f0d-2a6e8c4b1d3e";
const { privateKey, publicKey } = await jose.generateKeyPair("EdDSA");
const publicJwk = { ...await jose.exportJWK(publicKey), kid: "test" };
const source = readFileSync(new URL("../templates/next-app/lib/dormsLogin.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
class Redirect extends Error { constructor(url) { super(url); this.url = url; } }
async function token(extra = {}, options = {}) {
  return new jose.SignJWT({ name: "old name", teacher_verified: true, dorms: 99, grant_version: GRANT, ...extra })
    .setProtectedHeader({ alg: "EdDSA", kid: "test" }).setIssuer("https://dorms.school").setAudience(options.audience ?? CLIENT)
    .setSubject(MEMBER).setIssuedAt().setJti("test-jti").setExpirationTime(options.expiry ?? "1h").sign(privateKey);
}
function load(options = {}) {
  const state = { token: options.token, calls: [], fetch: options.fetch ?? (() => response({ sub: MEMBER, name: "fresh name", teacher_verified: false, dorms: 0 })) };
  const module = { exports: {} };
  const mocks = {
    "next/headers": { cookies: async () => ({ get: () => state.token ? { value: state.token } : undefined }) },
    "next/navigation": { redirect: (url) => { throw new Redirect(url); } },
    jose: { ...jose, createRemoteJWKSet: () => jose.createLocalJWKSet({ keys: [publicJwk] }), ...(options.jose ?? {}) },
  };
  vm.runInNewContext(compiled, { module, exports: module.exports, require: (name) => mocks[name] ?? require(name), Buffer, URL, AbortSignal,
    process: { env: { NODE_ENV: "development", DORMS_CLIENT_ID: CLIENT, DORMS_SITE_URL: "https://example.test", ...options.env } },
    fetch: async (url, init) => { state.calls.push({ url, init }); return state.fetch(url, init); },
  });
  return { sdk: module.exports, state };
}
const config = () => response({ active: true, scopes: ["openid", "profile"] });
const isReason = (reason) => (error) => error.name === "DormsAuthError" && error.reason === reason;

test("actual login flow round-trips dotted paths, Korean, query strings and fragments", async () => {
  const { sdk, state } = load({ fetch: config });
  for (const next of ["/dashboard", "/reports/week.1", "/lesson/2026.09.23", "/preview?url=https://example.com", "/수업?단원=3.1#메모"]) {
    const flow = await sdk.beginDormsLogin("http://localhost:3000/api/auth/dorms/start", next);
    const parsed = sdk.parseFlowCookie(flow.cookie.value);
    assert.equal(parsed.next, sdk.safeDormsNext(next));
    const auth = new URL(flow.authorizeUrl);
    assert.equal(auth.searchParams.get("state"), parsed.state);
    assert.equal(auth.searchParams.get("nonce"), parsed.nonce);
    assert.equal(auth.searchParams.get("code_challenge"), require("node:crypto").createHash("sha256").update(parsed.verifier).digest("base64url"));
  }
  assert.ok(state.calls.every(({ init }) => init.cache === "no-store" && init.redirect === "error"));
});

test("malformed, old, oversized and expired flow cookies fail without throwing", async () => {
  const { sdk } = load({ fetch: config });
  const { cookie } = await sdk.beginDormsLogin("http://localhost:3000/start", "/");
  const actual = sdk.parseFlowCookie(cookie.value);
  const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  for (const bad of [undefined, "", "%ZZ", "A".repeat(3501), "a.b.c.%ZZ", encode(null), encode({}), encode({ ...actual, createdAt: 1 }), encode({ ...actual, createdAt: Math.floor(Date.now() / 1000) + 60 }), encode({ ...actual, nonce: "short" }), encode({ ...actual, next: "a".repeat(513) }), cookie.value + "="]) assert.equal(sdk.parseFlowCookie(bad), null);
});

test("redirects reject normalized protocol-relative paths and control characters", () => {
  const { sdk } = load();
  for (const path of ["//evil.test", "/.//evil.test", "/../\\evil.test", "/\tevil.test", "https://evil.test", "/" + "가".repeat(400)]) assert.equal(sdk.safeDormsNext(path), "/");
  assert.equal(sdk.safeDormsNext("/safe.path?next=https://example.test"), "/safe.path?next=https://example.test");
});

test("email scope is fetched anew at every login, and production uses configured origin", async () => {
  const { sdk, state } = load({ env: { NODE_ENV: "production" } });
  for (const email of [true, false, true]) {
    state.fetch = () => response({ active: true, scopes: ["openid", "profile", ...(email ? ["email"] : [])] });
    const result = await sdk.beginDormsLogin("http://localhost:3000/start");
    const url = new URL(result.authorizeUrl);
    assert.equal(url.searchParams.get("scope"), email ? "openid profile email" : "openid profile");
    assert.equal(url.searchParams.get("redirect_uri"), "https://example.test/api/auth/dorms/callback");
    assert.equal(new URL(state.calls.at(-1).url).searchParams.get("redirect_uri"), url.searchParams.get("redirect_uri"));
  }
  assert.equal(state.calls.length, 3);
});

test("real signatures reject wrong audience, legacy tokens, tampering and expiry before userinfo", async () => {
  const valid = await token();
  for (const candidate of [await token({}, { audience: "another-client" }), await token({ grant_version: undefined }), await token({}, { expiry: "-1h" }), valid.slice(0, -12) + "AAAAAAAAAAAA", "not-a-token"]) {
    const { sdk, state } = load({ token: candidate });
    assert.equal(await sdk.getDormsUser(), null);
    assert.equal(state.calls.length, 0);
  }
});

test("get, refresh and require all fetch fresh permission, allowing policy relaxation", async () => {
  const { sdk, state } = load({ token: await token() });
  assert.equal((await sdk.getDormsUser()).name, "fresh name");
  assert.equal((await sdk.refreshDormsUser()).teacherVerified, false);
  assert.equal((await sdk.requireDormsUser()).dorms, 0);
  assert.equal(state.calls.length, 3);
  state.fetch = () => response({ reason: "access_denied", error: "invalid_token" }, 401);
  await assert.rejects(sdk.getDormsUser(), isReason("access_denied"));
  await assert.rejects(sdk.refreshDormsUser(), isReason("access_denied"));
  await assert.rejects(sdk.requireDormsUser({ next: "/members" }), (e) => e instanceof Redirect && e.url.startsWith("/dorms-denied?reason=access_denied"));
  assert.equal(state.calls.length, 6);
});

test("explicit stricter policy remains available without copying the provider default", async () => {
  const { sdk } = load({ token: await token() });
  assert.equal((await sdk.requireDormsUser()).teacherVerified, false);
  for (const policy of [{ requireTeacher: true }, { minDorms: 10 }, { minDorms: NaN }]) await assert.rejects(sdk.requireDormsUser(policy), (e) => e instanceof Redirect && e.url.startsWith("/dorms-denied?reason=access_denied"));
});

test("401 authentication_required returns null; revoked/disabled/policy stay denied", async () => {
  for (const [status, reason] of [[401, "authentication_required"], [401, "access_denied"], [403, "access_denied"]]) {
    const { sdk } = load({ token: await token(), fetch: () => response({ reason }, status) });
    if (reason === "authentication_required") {
      assert.equal(await sdk.getDormsUser(), null);
      await assert.rejects(sdk.requireDormsUser({ next: "/members" }), (e) => e instanceof Redirect && e.url === "/api/auth/dorms/start?next=%2Fmembers");
    } else await assert.rejects(sdk.getDormsUser(), isReason("access_denied"));
  }
});

test("429, 5xx, malformed responses, network and JWKS outages never use old claims or restart login", async () => {
  const cases = [() => response({ reason: "temporarily_unavailable" }, 429), () => response({}, 503), () => response({}, 200), () => { throw new Error("offline"); }];
  for (const fetch of cases) {
    const { sdk } = load({ token: await token(), fetch });
    await assert.rejects(sdk.getDormsUser(), isReason("temporarily_unavailable"));
    await assert.rejects(sdk.requireDormsUser(), (e) => e instanceof Redirect && e.url.startsWith("/dorms-denied?reason=temporarily_unavailable"));
  }
  const { sdk } = load({ token: await token(), jose: { jwtVerify: async () => { const e = new Error("timeout"); e.code = "ERR_JWKS_TIMEOUT"; throw e; } } });
  await assert.rejects(sdk.getDormsUser(), isReason("temporarily_unavailable"));
});

test("token exchange validates nonce, grant generation and callback binding", async () => {
  const { sdk, state } = load({ fetch: () => response({ id_token: "" }) });
  const nonce = "N".repeat(43);
  state.fetch = () => response({ id_token: tokenValue });
  let tokenValue = await token({ nonce });
  const result = await sdk.finishDormsLogin({ code: "authorization-code", verifier: "V".repeat(43), nonce, requestUrl: "http://localhost:3000/callback" });
  assert.equal(result.idToken, tokenValue);
  assert.equal(JSON.parse(state.calls[0].init.body).redirect_uri, "http://localhost:3000/api/auth/dorms/callback");
  tokenValue = await token({ nonce: "wrong" });
  await assert.rejects(sdk.finishDormsLogin({ code: "code", verifier: "V".repeat(43), nonce, requestUrl: "http://localhost:3000/callback" }), isReason("authentication_required"));
});

test("doreumi scope is requested only when DoRms says the site enabled the outfit", async () => {
  const { sdk, state } = load();
  for (const doreumi of [true, false, "yes"]) {
    state.fetch = () => response({ active: true, scopes: ["openid", "profile"], doreumi });
    const url = new URL((await sdk.beginDormsLogin("http://localhost:3000/start")).authorizeUrl);
    assert.equal(url.searchParams.get("scope"), doreumi === true ? "openid profile doreumi" : "openid profile");
  }
  state.fetch = () => response({ active: true, scopes: ["openid", "profile", "doreumi"] });
  await assert.rejects(() => sdk.beginDormsLogin("http://localhost:3000/start"), isReason("temporarily_unavailable"));
});
