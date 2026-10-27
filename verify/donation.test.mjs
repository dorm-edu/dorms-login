import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
const require = createRequire(import.meta.url);
const MEMBER = "ab5f4d8c-7e2a-4c1b-9f0d-2a6e8c4b1d3e";
const RECIPIENT = "bb5f4d8c-7e2a-4c1b-9f0d-2a6e8c4b1d3e";
const REQUEST = "cb5f4d8c-7e2a-4c1b-9f0d-2a6e8c4b1d3e";
const compiled = ts.transpileModule(readFileSync(new URL("../templates/donation/lib/dormsDonation.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });
function load() {
  const state = { donations: "approved", jar: { dorms_session: "login-token" }, origin: "https://example.test", site: "same-origin", user: { id: MEMBER, expiresAt: Math.floor(Date.now() / 1000) + 3600 }, calls: [], fetch: () => response({ donation_token: "T".repeat(43), expires_in: 3600, subject: MEMBER }) };
  const module = { exports: {} };
  const mocks = { "server-only": {}, "next/headers": { cookies: async () => ({ get: (key) => state.jar[key] ? { value: state.jar[key] } : undefined }), headers: async () => new Headers({ ...(state.origin ? { origin: state.origin } : {}), "sec-fetch-site": state.site }) }, "./dormsLogin": { SESSION_COOKIE: "dorms_session", getDormsUser: async () => state.user,
    beginDormsLogin: async () => ({ authorizeUrl: `https://dorms.school/api/sso/authorize?${new URLSearchParams({ response_type: "code", client_id: REQUEST, scope: "openid profile", state: "login-state-0123456789", code_challenge: "L".repeat(43), code_challenge_method: "S256" })}`, cookie: { name: "dorms_flow", value: "flow", maxAge: 600 }, donations: state.donations }), safeDormsNext: (value) => value?.startsWith("/") && !value.startsWith("//") ? value : "/", callbackUrl: () => "https://example.test/api/auth/dorms/callback" } };
  vm.runInNewContext(compiled, { module, exports: module.exports, require: (name) => mocks[name] ?? require(name), Buffer, URL, AbortSignal, Date,
    process: { env: { NODE_ENV: "production", DORMS_CLIENT_ID: REQUEST, DORMS_SITE_URL: "https://example.test" } },
    fetch: async (url, init) => { state.calls.push({ url, init }); return state.fetch(url, init); },
  });
  return { sdk: module.exports, state };
}
async function authorized() {
  const context = load(), { sdk, state } = context;
  const flow = await sdk.beginDonation("https://example.test/start", "/live");
  const params = new URL(flow.authorizeUrl).searchParams;
  const result = await sdk.finishDonation("https://example.test/callback", "code", params.get("state"), flow.flow);
  state.jar.dorms_donation = result.value;
  return { ...context, flow, result };
}
const status = { subject: MEMBER, availableBalance: 5, dailyRemaining: 2, resetsAt: "2026-10-09T00:00:00+09:00" };
const input = { recipientId: RECIPIENT, amount: 1, requestId: REQUEST };
const reason = (value) => (e) => e.name === "DormsDonationError" && e.reason === value;
test("generated PKCE flow binds state, member, callback and login lifetime", async () => {
  const { sdk, state, flow, result } = await authorized();
  const params = new URL(flow.authorizeUrl).searchParams;
  const saved = JSON.parse(Buffer.from(flow.flow, "base64url").toString());
  assert.equal(params.get("code_challenge"), require("node:crypto").createHash("sha256").update(saved.verifier).digest("base64url"));
  assert.equal(params.get("redirect_uri"), "https://example.test/api/auth/dorms/donation/callback");
  assert.equal(Number(params.get("session_expires_at")), state.user.expiresAt);
  assert.ok(result.maxAge <= 3600); assert.equal(result.next, "/live");
  const options = sdk.donationCookieOptions(3600);
  assert.equal(options.secure, true); assert.equal(options.httpOnly, true); assert.equal(options.sameSite, "lax"); assert.equal(options.domain, undefined);
  await assert.rejects(sdk.finishDonation("https://example.test/callback", "code", "wrong", flow.flow), reason("authentication_required"));
  state.jar.dorms_session = "changed-session";
  await assert.rejects(sdk.finishDonation("https://example.test/callback", "code", saved.state, flow.flow), reason("authentication_required"));
});
test("donation credential cannot survive missing or replaced login sessions", async () => {
  const { sdk, state } = await authorized();
  state.fetch = () => response(status);
  assert.equal((await sdk.getDonationStatus()).subject, MEMBER);
  state.jar.dorms_session = "next-session";
  await assert.rejects(sdk.getDonationStatus(), reason("consent_required"));
  state.user = null;
  await assert.rejects(sdk.getDonationStatus(), reason("authentication_required"));
});
test("send rejects cross-origin/missing Origin and invalid boundaries before provider write", async () => {
  const { sdk, state } = await authorized();
  for (const origin of ["https://evil.test", "", "https://example.test.evil.test"]) {
    state.origin = origin;
    await assert.rejects(sdk.sendDonation(input), reason("forbidden"));
  }
  state.origin = "https://example.test"; state.site = "cross-site";
  await assert.rejects(sdk.sendDonation(input), reason("forbidden")); state.site = "same-origin";
  for (const amount of [0, 4, 1.5, NaN, "1"]) await assert.rejects(sdk.sendDonation({ ...input, amount }), reason("invalid_request"));
  await assert.rejects(sdk.sendDonation({ ...input, recipientId: "email@example.test" }), reason("invalid_request"));
  assert.equal(state.calls.length, 1);
});
test("same request survives lost response; provider denial and outages are preserved", async () => {
  const { sdk, state } = await authorized();
  state.fetch = () => { throw new Error("response lost"); };
  await assert.rejects(sdk.sendDonation(input), reason("temporarily_unavailable"));
  state.fetch = () => response({ ...status, transferId: REQUEST, amount: 1 });
  const result = await sdk.sendDonation(input);
  assert.equal(result.transferId, REQUEST);
  assert.equal(state.calls.at(-1).init.body, state.calls.at(-2).init.body);
  assert.ok(state.calls.every((call) => call.init.cache === "no-store" && call.init.redirect === "error"));
  state.fetch = () => response({ reason: "daily_limit_exceeded" }, 409);
  await assert.rejects(sdk.sendDonation(input), (e) => e.reason === "daily_limit_exceeded" && e.status === 409);
  state.fetch = () => response({ ...status, subject: RECIPIENT });
  await assert.rejects(sdk.getDonationStatus(), reason("authentication_required"));
});
test("revoke uses only donation credential and fails closed on provider outage", async () => {
  const { sdk, state } = await authorized();
  state.fetch = () => response({ revoked: true }); await sdk.revokeDonation();
  assert.match(state.calls.at(-1).url, /\/revoke$/);
  assert.equal(state.calls.at(-1).init.headers.Authorization, `Bearer ${"T".repeat(43)}`);
  state.fetch = () => response({}, 503);
  await assert.rejects(sdk.revokeDonation(), reason("temporarily_unavailable"));
});

test("provider approval errors require valid state and callback cookies expire in ten minutes", async () => {
  const { sdk, state, flow } = await authorized();
  const saved = JSON.parse(Buffer.from(flow.flow, "base64url").toString());
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  await assert.rejects(sdk.finishDonation("https://example.test/callback", null, saved.state, flow.flow, "approval_required"), reason("approval_required"));
  await assert.rejects(sdk.finishDonation("https://example.test/callback", null, "wrong", flow.flow, "approval_required"), reason("authentication_required"));
  await assert.rejects(sdk.finishDonation("https://example.test/callback", "code", saved.state, encode({ ...saved, createdAt: saved.createdAt - 601 })), reason("authentication_required"));
  assert.equal(state.calls.length, 1, "invalid/denied callbacks never exchange a code");
});

test("token exchange proves current login while donation calls use only dedicated credentials", async () => {
  const { sdk, state, flow } = await authorized();
  const exchange = state.calls[0];
  assert.match(exchange.url, /\/token$/);
  assert.equal(exchange.init.headers.Authorization, "Bearer login-token");
  assert.equal(Buffer.from(flow.flow, "base64url").toString().includes("login-token"), false, "flow cookie carries only a hash of the login");
  state.fetch = () => response(status);
  await sdk.getDonationStatus();
  assert.equal(state.calls.at(-1).init.headers.Authorization, `Bearer ${"T".repeat(43)}`);
  assert.equal(state.calls.at(-1).init.headers.Authorization.includes("login-token"), false);
});

test("v0.5 login with donation asks for it only on an approved site, with its own PKCE bound to the login state", async () => {
  const { sdk, state } = load();
  assert.equal(sdk.DONATION_AT_LOGIN, false, "the raw template is the separate mode until the installer writes the choice");
  const login = await sdk.beginDonationLogin("https://example.test/api/auth/dorms/start", "/room/1");
  const params = new URL(login.authorizeUrl).searchParams;
  assert.equal(params.get("scope"), "openid profile donation");
  const saved = JSON.parse(Buffer.from(login.donationFlow, "base64url").toString());
  assert.equal(saved.state, "login-state-0123456789");
  assert.equal(params.get("donation_code_challenge"), require("node:crypto").createHash("sha256").update(saved.verifier).digest("base64url"));
  assert.notEqual(params.get("donation_code_challenge"), params.get("code_challenge"));
  assert.equal(login.cookie.name, "dorms_flow");
  for (const donations of ["pending", "none", null]) {
    state.donations = donations;
    const plain = await sdk.beginDonationLogin("https://example.test/api/auth/dorms/start", "/");
    assert.equal(plain.donationFlow, null);
    assert.equal(new URL(plain.authorizeUrl).searchParams.get("scope"), "openid profile");
    assert.equal(new URL(plain.authorizeUrl).searchParams.get("donation_code_challenge"), null);
  }
});
test("v0.5 login callback trades the donation code with the new login token and binds the cookie to it", async () => {
  const { sdk, state } = load();
  const login = await sdk.beginDonationLogin("https://example.test/api/auth/dorms/start", "/room/1");
  const saved = JSON.parse(Buffer.from(login.donationFlow, "base64url").toString());
  const loginExp = Math.floor(Date.now() / 1000) + 1800;
  const input = { idToken: "fresh-login-token", subject: MEMBER, expiresAt: loginExp, state: saved.state, code: "D".repeat(43), flow: login.donationFlow };
  const pass = await sdk.finishDonationLogin("https://example.test/api/auth/dorms/callback", input);
  const call = state.calls.at(-1);
  assert.match(call.url, /\/api\/connect\/donations\/token$/);
  assert.equal(call.init.headers.Authorization, "Bearer fresh-login-token");
  assert.deepEqual(JSON.parse(call.init.body), { client_id: REQUEST, redirect_uri: "https://example.test/api/auth/dorms/donation/callback", code: "D".repeat(43), code_verifier: saved.verifier });
  const cookie = JSON.parse(Buffer.from(pass.value, "base64url").toString());
  assert.equal(cookie.session, require("node:crypto").createHash("sha256").update("fresh-login-token").digest("base64url"));
  assert.ok(cookie.expiresAt <= loginExp && pass.maxAge <= 1800, "never outlives the login");
  // Once the new login cookie is in place, sends use the dedicated credential.
  state.jar = { dorms_session: "fresh-login-token", dorms_donation: pass.value };
  state.fetch = () => response(status);
  assert.equal((await sdk.getDonationStatus()).subject, MEMBER);
  const calls = state.calls.length;
  await assert.rejects(sdk.finishDonationLogin("https://example.test/api/auth/dorms/callback", { ...input, state: "other-state-0123456789" }), reason("authentication_required"));
  await assert.rejects(sdk.finishDonationLogin("https://example.test/api/auth/dorms/callback", { ...input, code: null }), reason("consent_required"));
  await assert.rejects(sdk.finishDonationLogin("https://example.test/api/auth/dorms/callback", { ...input, flow: undefined }), reason("authentication_required"));
  const stale = Buffer.from(JSON.stringify({ ...saved, createdAt: saved.createdAt - 601 })).toString("base64url");
  await assert.rejects(sdk.finishDonationLogin("https://example.test/api/auth/dorms/callback", { ...input, flow: stale }), reason("authentication_required"));
  assert.equal(state.calls.length, calls, "bad callbacks never exchange a code");
  state.fetch = () => response({ donation_token: "T".repeat(43), expires_in: 3600, subject: RECIPIENT });
  await assert.rejects(sdk.finishDonationLogin("https://example.test/api/auth/dorms/callback", input), reason("temporarily_unavailable"), "a pass for another member is refused");
});
