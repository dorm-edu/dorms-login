import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "dorms-login.js");
const CLIENT = "3b5f4d8c-7e2a-4c1b-9f0d-2a6e8c4b1d3e";

function scaffold({ src, alias }) {
  const dir = mkdtempSync(path.join(tmpdir(), "dorms-login-"));
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "site", dependencies: { next: "15.0.0", react: "19.0.0" } }));
  mkdirSync(path.join(dir, src ? "src/app" : "app"), { recursive: true });
  if (alias) writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }));
  return dir;
}
const run = (dir, ...args) => spawnSync(process.execPath, [BIN, ...args, "--dir", dir], { encoding: "utf8" });

test("detect: App Router 프로젝트를 알아본다", () => {
  const dir = scaffold({ src: true, alias: true });
  const r = run(dir, "detect");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /App Router \(src\/app\)/);
});

test("init: 파일을 넣고 자리를 채우며, 별칭이 있으면 @/lib 로 가져온다", () => {
  const dir = scaffold({ src: true, alias: true });
  const r = run(dir, "init", "--client-id", CLIENT, "--site", "https://my-app.vercel.app/", "--require-teacher", "--min-dorms", "10", "--email", "--no-install");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const lib = readFileSync(path.join(dir, "src/lib/dormsLogin.ts"), "utf8");
  assert.match(lib, /requireTeacher: true, minDorms: 10/);
  assert.match(lib, /DORMS_WANTS_EMAIL = true/);
  assert.equal(lib.includes("__DORMS_"), false);
  const cb = readFileSync(path.join(dir, "src/app/api/auth/dorms/callback/route.ts"), "utf8");
  assert.match(cb, /from "@\/lib\/dormsLogin"/);
  for (const f of ["src/components/DormsLoginButton.tsx", "src/app/api/auth/dorms/start/route.ts", "src/app/api/auth/dorms/logout/route.ts", "src/app/dorms-denied/page.tsx"]) assert.ok(existsSync(path.join(dir, f)), f);
  const env = readFileSync(path.join(dir, ".env.local"), "utf8");
  assert.match(env, new RegExp(`DORMS_CLIENT_ID=${CLIENT}`));
  assert.match(env, /DORMS_SITE_URL=https:\/\/my-app\.vercel\.app\n/);
  assert.match(readFileSync(path.join(dir, ".gitignore"), "utf8"), /\.dorms-login\//);
});

test("init: 별칭이 없으면 상대 경로로 가져오고, 기존 파일은 덮어쓰지 않는다", () => {
  const dir = scaffold({ src: false, alias: false });
  mkdirSync(path.join(dir, "components"), { recursive: true });
  writeFileSync(path.join(dir, "components/DormsLoginButton.tsx"), "// mine");
  const r = run(dir, "init", "--client-id", CLIENT, "--site", "https://a.b", "--no-install");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(readFileSync(path.join(dir, "components/DormsLoginButton.tsx"), "utf8"), "// mine");
  assert.ok(existsSync(path.join(dir, ".dorms-login/components/DormsLoginButton.tsx")));
  const start = readFileSync(path.join(dir, "app/api/auth/dorms/start/route.ts"), "utf8");
  assert.match(start, /from "\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/lib\/dormsLogin"/);
  assert.match(readFileSync(path.join(dir, "lib/dormsLogin.ts"), "utf8"), /requireTeacher: false, minDorms: 0/);
});

test("init: 잘못된 id·주소는 거절한다", () => {
  const dir = scaffold({ src: true, alias: true });
  assert.notEqual(run(dir, "init", "--client-id", "nope", "--site", "https://a.b", "--no-install").status, 0);
  assert.notEqual(run(dir, "init", "--client-id", CLIENT, "--site", "http://a.b", "--no-install").status, 0);
});
