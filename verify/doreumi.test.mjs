import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
const require = createRequire(import.meta.url);
const compiled = ts.transpileModule(readFileSync(new URL("../templates/doreumi/lib/dormsDoreumi.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
class DormsAuthError extends Error { constructor(reason) { super(reason); this.name = "DormsAuthError"; this.reason = reason; this.status = reason === "authentication_required" ? 401 : reason === "access_denied" ? 403 : 503; } }
const outfit = {
  version: 1,
  items: [
    { id: "c-123456789abc", name: "우주비행사 세트", slots: ["top", "bottom"], hand: null, rigged: true, bone: null, asset: "https://dorms.school/api/sso/doreumi/items/c-123456789abc", sha256: "a".repeat(64), preview: "https://dorms.school/api/doreumi/item-files/preview/x" },
    { id: "flower-pin", name: "꽃 머리핀", slots: ["head"], hand: null, rigged: false, bone: "headAccessory", asset: null, sha256: null, preview: "https://evil.test/p.webp" },
  ],
  colors: { body: "#ffeeaa", belly: "javascript:alert(1)" },
  model: "https://dorms.school/doreumi/immutable/doreumi-master.x.glb", rig: "https://dorms.school/doreumi/rig-contract.json", motions: "https://dorms.school/doreumi/immutable/registry.runtime.x.json", license: "도름이 © 아인T, CC BY-NC 4.0",
};
function load() {
  const state = { jar: { dorms_session: "login-token" }, calls: [], fetch: () => json({ sub: "x", doreumi: outfit }) };
  const module = { exports: {} };
  const mocks = { "server-only": {}, "next/headers": { cookies: async () => ({ get: (key) => state.jar[key] ? { value: state.jar[key] } : undefined }) }, "./dormsLogin": { SESSION_COOKIE: "dorms_session", DormsAuthError } };
  vm.runInNewContext(compiled, { module, exports: module.exports, require: (name) => mocks[name] ?? require(name), Buffer, URL, AbortSignal, Response, TextDecoder, atob,
    process: { env: { NODE_ENV: "production" } },
    fetch: async (url, init) => { state.calls.push({ url, init }); return state.fetch(url, init); },
  });
  return { sdk: module.exports, state };
}

test("outfit: token stays on the server, item files point at this site, untrusted fields are dropped", async () => {
  const { sdk, state } = load();
  const result = await sdk.getDormsDoreumi();
  assert.equal(state.calls[0].url, "https://dorms.school/api/sso/doreumi");
  assert.equal(state.calls[0].init.headers.Authorization, "Bearer login-token");
  assert.equal(state.calls[0].init.cache, "no-store");
  assert.equal(result.items[0].asset, "/api/auth/dorms/doreumi/items/c-123456789abc");
  assert.equal(result.items[1].asset, null, "code-drawn items have no file");
  assert.equal(result.items[1].preview, null, "previews only from DoRms");
  assert.deepEqual(JSON.parse(JSON.stringify(result.colors)), { body: "#ffeeaa" });
  assert.equal(result.motions, outfit.motions);
});

test("outfit: missing session, refusal and old sessions become null; outages throw", async () => {
  const { sdk, state } = load();
  state.jar = {};
  assert.equal(await sdk.getDormsDoreumi(), null);
  assert.equal(state.calls.length, 0);
  state.jar = { dorms_session: "t" };
  for (const status of [401, 403]) { state.fetch = () => json({ reason: "x" }, status); assert.equal(await sdk.getDormsDoreumi(), null); }
  for (const make of [() => json({}, 503), () => json({ doreumi: { ...outfit, model: "https://evil.test/m.glb" } }), () => { throw new Error("offline"); }]) {
    state.fetch = make;
    await assert.rejects(() => sdk.getDormsDoreumi(), (e) => e.reason === "temporarily_unavailable");
  }
});

function glb(json) {
  let text = JSON.stringify(json);
  while (text.length % 4) text += " ";
  const body = new TextEncoder().encode(text);
  const out = new Uint8Array(20 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, out.length, true);
  view.setUint32(12, body.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(body, 20);
  return out;
}

const pngHeader = (w, h) => {
  const d = Buffer.alloc(33);
  d.writeUInt32BE(0x89504e47, 0); d.writeUInt32BE(0x0d0a1a0a, 4); d.writeUInt32BE(13, 8); d.writeUInt32BE(0x49484452, 12);
  d.writeUInt32BE(w, 16); d.writeUInt32BE(h, 20);
  return d.toString("base64");
};
const bigPng = pngHeader(16384, 16384);
const tri = { asset: { version: "2.0" }, accessors: [{ count: 3, type: "VEC3", componentType: 5126, bufferView: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], nodes: [{ mesh: 0 }] };

test("item proxy: only item-id shapes, maps DoRms refusals, streams only glb within the size cap", async () => {
  const { sdk, state } = load();
  for (const bad of ["../x", "A", "", "c-1/2"]) assert.equal((await sdk.fetchDormsDoreumiItem(bad)).status, 404);
  assert.equal(state.calls.length, 0);
  state.fetch = () => new Response(glb(tri), { status: 200, headers: { "content-type": "model/gltf-binary" } });
  const ok = await sdk.fetchDormsDoreumiItem("c-123456789abc");
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("cache-control"), "private, no-store");
  assert.equal(state.calls.at(-1).url, "https://dorms.school/api/sso/doreumi/items/c-123456789abc");
  for (const [status, expected] of [[401, 401], [403, 403], [404, 404], [500, 503]]) {
    state.fetch = () => json({}, status);
    assert.equal((await sdk.fetchDormsDoreumiItem("c-123456789abc")).status, expected);
  }
  // 남이 만든 파일이 바깥 주소(이미지·버퍼)를 가리키거나 GLB 가 아니면 넘기지 않는다
  for (const bytes of [
    glb({ asset: { version: "2.0" }, images: [{ uri: "https://evil.test/t.png" }] }),
    glb({ asset: { version: "2.0" }, buffers: [{ uri: "a.bin", byteLength: 4 }] }),
    (() => {
      // 두 번째 JSON 조각에 바깥 주소를 숨긴 파일(three.js 는 마지막 JSON 조각을 쓴다)
      const first = glb({ asset: { version: "2.0" } });
      const extra = glb({ asset: { version: "2.0" }, images: [{ uri: "https://evil.test/t.png" }] }).slice(12);
      const joined = new Uint8Array(first.length + extra.length);
      joined.set(first);
      joined.set(extra, first.length);
      new DataView(joined.buffer).setUint32(8, joined.length, true);
      return joined;
    })(),
    (() => {
      // 헤더 길이를 앞 조각까지만 적고 뒤에 JSON 조각을 숨긴 파일
      const first = glb({ asset: { version: "2.0" } });
      const extra = glb({ asset: { version: "2.0" }, images: [{ uri: "https://evil.test/t.png" }] }).slice(12);
      const joined = new Uint8Array(first.length + extra.length);
      joined.set(first);
      joined.set(extra, first.length);
      return joined;
    })(),
    // 같은 키를 두 번 써서 바깥 주소를 숨긴 파일(앞 키를 읽는 도구도 있다)
    (() => {
      let text = '{"asset":{"version":"2.0"},"images":[{"uri":"https://evil.test/t.png"}],"images":[]}';
      while (text.length % 4) text += " ";
      const body = new TextEncoder().encode(text);
      const out = new Uint8Array(20 + body.length);
      const view = new DataView(out.buffer);
      view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, out.length, true);
      view.setUint32(12, body.length, true); view.setUint32(16, 0x4e4f534a, true);
      out.set(body, 20);
      return out;
    })(),
    // 3MB 안에서도 거대한 배열을 선언한 파일
    glb({ asset: { version: "2.0" }, accessors: [{ count: 50_000_000, type: "VEC4", componentType: 5126, bufferView: 0 }] }),
    // 목록 자리에 배열 대신 객체를 넣어 개수 검사를 피하는 파일
    glb({ asset: { version: "2.0" }, nodes: Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [String(i), {}])) }),
    // 버퍼에 data: 주소를 달아 검사한 BIN 대신 다른 바이트를 읽히는 파일
    glb({ asset: { version: "2.0" }, buffers: [{ byteLength: 33, uri: `data:image/png;base64,${bigPng}` }] }),
    // data: 그림도 받지 않는다(도름스 업로드 규칙과 같이)
    glb({ asset: { version: "2.0" }, images: [{ uri: `data:image/png;base64,${bigPng}` }] }),
    // 선언 없이 부품에 숨긴 GPU 인스턴싱(면 상한을 피해 수십만 개를 그린다)
    glb({ ...tri, nodes: [{ mesh: 0, extensions: { EXT_mesh_gpu_instancing: { attributes: { TRANSLATION: 0 } } } }] }),
    // 같은 모양을 부품 200개가 두 조각씩 그리면 400번 그린다
    glb({ ...tri, nodes: Array.from({ length: 200 }, () => ({ mesh: 0 })), meshes: [{ primitives: [{ attributes: { POSITION: 0 } }, { attributes: { POSITION: 0 } }] }] }),
    glb({ ...tri, animations: [{ channels: [], samplers: [] }] }),
    glb({ ...tri, nodes: [{ mesh: "0" }] }),
    glb({ ...tri, nodes: [{ mesh: 0, skin: 0 }], skins: [{ joints: Array.from({ length: 100_000 }, () => 0) }] }),
    glb({ ...tri, nodes: [{ mesh: 0, children: [1] }, { children: [0] }] }),
    new Uint8Array([1, 2, 3]),
  ]) {
    state.fetch = () => new Response(bytes, { status: 200, headers: { "content-type": "model/gltf-binary" } });
    assert.equal((await sdk.fetchDormsDoreumiItem("c-123456789abc")).status, 503);
  }
  state.fetch = () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } });
  assert.equal((await sdk.fetchDormsDoreumiItem("c-123456789abc")).status, 503);
  state.fetch = () => new Response(new Uint8Array(3 * 1024 * 1024 + 1), { status: 200, headers: { "content-type": "model/gltf-binary" } });
  assert.equal((await sdk.fetchDormsDoreumiItem("c-123456789abc")).status, 503);
  state.jar = {};
  assert.equal((await sdk.fetchDormsDoreumiItem("c-123456789abc")).status, 401);
});
