import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const compiled = ts.transpileModule(readFileSync(new URL("../templates/donation/components/DormsDonationButton.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function button() {
  const state = { messages: [], requests: [], redirects: [], successes: [], fetch: async () => new Response(JSON.stringify({ reason: "temporarily_unavailable" }), { status: 503 }) };
  const module = { exports: {} };
  const refs = []; let refIndex = 0;
  const jsx = (type, props) => ({ type, props });
  const mocks = { react: { useRef: (current) => { const index = refIndex++; return refs[index] ??= { current }; }, useState: (value) => [value, (next) => state.messages.push(next)] }, "react/jsx-runtime": { jsx, jsxs: jsx } };
  vm.runInNewContext(compiled, { module, exports: module.exports, require: (name) => mocks[name], crypto: { randomUUID: () => crypto.randomUUID() }, location: { pathname: "/live", search: "?host=1", hash: "" }, window: { location: { assign: (url) => state.redirects.push(url) } }, fetch: async (url, init) => { state.requests.push({ url, init }); return state.fetch(); } });
  function render(props = {}) {
    refIndex = 0;
    const tree = module.exports.DormsDonationButton({ recipientId: "recipient", amount: 1, onSuccess: (value) => state.successes.push(value), ...props });
    return tree.props.children[0].props.onClick;
  }
  return { state, click: render(), render };
}
test("button keeps request and recipient after uncertain response, then emits success once", async () => {
  const { state, click } = button();
  await click(); await click();
  assert.equal(state.requests[0].init.body, state.requests[1].init.body);
  assert.equal(state.successes.length, 0);
  state.fetch = async () => new Response(JSON.stringify({ transferId: "receipt", amount: 1 }), { status: 200 });
  await click(); assert.equal(state.successes.length, 1);
  assert.equal(state.requests[1].init.body, state.requests[2].init.body);
  await click(); assert.notEqual(state.requests[2].init.body, state.requests[3].init.body);
});
test("button blocks double-clicks in flight and keeps definite business failures distinct", async () => {
  const { state, click } = button();
  let done;
  state.fetch = () => new Promise((resolve) => { done = resolve; });
  const first = click(); await click(); assert.equal(state.requests.length, 1);
  done(new Response(JSON.stringify({ reason: "daily_limit" }), { status: 409 })); await first;
  assert.ok(state.messages.some((value) => typeof value === "string" && value.includes("한국 시간 자정")));
  state.fetch = async () => new Response(JSON.stringify({ reason: "insufficient_dorms" }), { status: 409 });
  await click(); assert.notEqual(state.requests[0].init.body, state.requests[1].init.body);
  assert.equal(state.successes.length, 0);
});
test("first consent returns to the same app screen without sending automatically", async () => {
  const { state, click } = button();
  state.fetch = async () => new Response(JSON.stringify({ reason: "consent_required" }), { status: 403 });
  await click();
  assert.equal(state.redirects[0], "/api/auth/dorms/donation/start?next=%2Flive%3Fhost%3D1");
  assert.equal(state.successes.length, 0);
});

test("changing recipient or amount never silently resends an unresolved earlier donation", async () => {
  const { state, click, render } = button();
  await click();
  const originalBody = state.requests[0].init.body;
  await render({ recipientId: "another-recipient" })();
  await render({ amount: 2 })();
  assert.equal(state.requests.length, 1, "neither changed recipient nor amount sends the old request");
  assert.ok(state.messages.some((value) => typeof value === "string" && value.includes("이전")));
  await render()();
  assert.equal(state.requests.length, 2);
  assert.equal(state.requests[1].init.body, originalBody, "returning to the original target retries the exact request");
});
