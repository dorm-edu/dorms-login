import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const BIN = fileURLToPath(new URL("../bin/dorms-login.js", import.meta.url));
const CLIENT = "3b5f4d8c-7e2a-4c1b-9f0d-2a6e8c4b1d3e";
function scaffold(t, { src = false, paths = {}, ts = true, next = "15.5.26", app = true } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "dorms-login-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "site", dependencies: { next, react: "19.1.0", jose: "^6.2.3" } }));
  if (app) mkdirSync(path.join(dir, src ? "src/app" : "app"), { recursive: true });
  if (ts) writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { paths } }));
  return dir;
}
const run = (dir, ...args) => spawnSync(process.execPath, [BIN, ...args, "--dir", dir], { encoding: "utf8", env: { ...process.env, DORMS_CLIENT_ID: "", DORMS_SITE_URL: "" } });
const init = (dir, ...args) => run(dir, "init", "--client-id", CLIENT, "--site", "https://example.test", "--no-install", ...args);
const hash = (text) => createHash("sha256").update(text).digest("hex");

test("install matrix resolves real files regardless of aliases or app placement", (t) => {
  for (const [src, paths] of [[true, { "@/*": ["./src/*"] }], [false, { "@/*": ["./src/*"] }], [true, { "@/components/*": ["./src/components/*"] }], [false, {}]]) {
    const dir = scaffold(t, { src, paths });
    const result = init(dir); assert.equal(result.status, 0, result.stdout + result.stderr);
    const route = path.join(dir, src ? "src/app" : "app", "api/auth/dorms/start/route.ts");
    const imp = /from "([^"]*dormsLogin)"/.exec(readFileSync(route, "utf8"))[1];
    assert.ok(existsSync(path.resolve(path.dirname(route), imp) + ".ts"));
    assert.equal(readFileSync(path.join(dir, src ? "src/lib/dormsLogin.ts" : "lib/dormsLogin.ts"), "utf8").includes("__DORMS_"), false);
    assert.equal(JSON.parse(readFileSync(path.join(dir, ".dorms-login.json"), "utf8")).version, "0.4.1");
  }
});

test("unsupported JS/Pages/old Next/basePath projects fail before writes", (t) => {
  for (const options of [{ ts: false }, { app: false }, { next: "14.2.0" }, { basePath: true }]) {
    const dir = scaffold(t, options);
    if (options.basePath) writeFileSync(path.join(dir, "next.config.ts"), 'export default { basePath: "/school" };');
    assert.equal(init(dir).status, 2);
    assert.equal(existsSync(path.join(dir, "lib")), false);
  }
  for (const config of ['const basePath = "/school"; export default { basePath };', 'export default { "basePath": "/school" };', 'const key="basePath"; export default { [key]: "/school" };']) {
    const dir = scaffold(t); writeFileSync(path.join(dir, "next.config.mjs"), config);
    assert.equal(init(dir).status, 2); assert.equal(existsSync(path.join(dir, "lib")), false);
  }
});

test("reject subpaths, credentials, insecure URLs and shell metacharacters without writes", (t) => {
  for (const site of ["https://example.test/app", "https://example.test/$(echo)", "https://example.test/;echo", "https://example.test/`echo`", "https://u:p@example.test", "https://example.test?x=1", "http://example.test"]) {
    const dir = scaffold(t);
    const result = run(dir, "init", "--client-id", CLIENT, "--site", site, "--no-install");
    assert.equal(result.status, 2, site); assert.equal(existsSync(path.join(dir, "lib")), false);
  }
});

test("dotenv comments, blanks, quoted values and export syntax are distinguished", (t) => {
  const dir = scaffold(t);
  writeFileSync(path.join(dir, ".env.local"), '# DORMS_CLIENT_ID=comment\nDORMS_CLIENT_ID=""\n# DORMS_SITE_URL=https://old.test\n');
  assert.equal(init(dir).status, 0);
  const env = readFileSync(path.join(dir, ".env.local"), "utf8");
  assert.match(env, new RegExp(`\nDORMS_CLIENT_ID=${CLIENT}\n`));
  assert.match(env, /\nDORMS_SITE_URL=https:\/\/example.test\n/);
  writeFileSync(path.join(dir, ".env.local"), `export DORMS_CLIENT_ID="${CLIENT}" # public\nDORMS_SITE_URL='https://example.test'\n`);
  assert.equal(run(dir, "upgrade", "--no-install").status, 0);
});

test("safe upgrade replaces owned unmodified files and preserves customized files with diff", (t) => {
  const dir = scaffold(t); assert.equal(init(dir).status, 0);
  const lib = path.join(dir, "lib/dormsLogin.ts"), button = path.join(dir, "components/DormsLoginButton.tsx"), manifest = path.join(dir, ".dorms-login.json");
  const original = readFileSync(lib, "utf8"), old = original + "\n// previous generated version\n";
  writeFileSync(lib, old);
  const record = JSON.parse(readFileSync(manifest, "utf8")); record.version = "0.1.9"; record.files["lib/dormsLogin.ts"] = hash(old); writeFileSync(manifest, JSON.stringify(record));
  const custom = readFileSync(button, "utf8") + "\n// my design\n"; writeFileSync(button, custom);
  const result = run(dir, "upgrade", "--no-install"); assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(readFileSync(lib, "utf8"), original); assert.equal(readFileSync(button, "utf8"), custom);
  assert.ok(existsSync(path.join(dir, ".dorms-login/review/components/DormsLoginButton.tsx.diff")));
  assert.equal(run(dir, "upgrade", "--accept-reviewed", "--no-install").status, 0);
  assert.equal(JSON.parse(readFileSync(manifest, "utf8")).version, "0.4.1");
  assert.equal(run(dir, "upgrade", "--no-install").status, 1, "future upgrades must keep custom files protected");
  assert.equal(readFileSync(button, "utf8"), custom);
});

test("legacy or unrelated files are never silently adopted or overwritten", (t) => {
  const dir = scaffold(t); mkdirSync(path.join(dir, "lib")); writeFileSync(path.join(dir, "lib/dormsLogin.ts"), "// my pre-existing authentication");
  assert.equal(init(dir).status, 1);
  assert.equal(readFileSync(path.join(dir, "lib/dormsLogin.ts"), "utf8"), "// my pre-existing authentication");
  assert.ok(existsSync(path.join(dir, ".dorms-login/review/lib/dormsLogin.ts")));
  assert.equal(init(dir, "--force").status, 2);
});

test("reference diffs never invoke Git external diff helpers", (t) => {
  const dir = scaffold(t);
  mkdirSync(path.join(dir, "lib")); writeFileSync(path.join(dir, "lib/dormsLogin.ts"), "// existing file");
  const helper = path.join(dir, "external-diff.sh"), marker = path.join(dir, "external-ran");
  writeFileSync(helper, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 });
  const result = spawnSync(process.execPath, [BIN, "init", "--client-id", CLIENT, "--site", "https://example.test", "--no-install", "--dir", dir], { encoding: "utf8", env: { ...process.env, DORMS_CLIENT_ID: "", DORMS_SITE_URL: "", GIT_EXTERNAL_DIFF: helper } });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(existsSync(marker), false);
  assert.ok(existsSync(path.join(dir, ".dorms-login/review/lib/dormsLogin.ts.diff")));
});

test("existing different credentials and symlink destinations stop before modifying project files", (t) => {
  const dir = scaffold(t); writeFileSync(path.join(dir, ".env.local"), "DORMS_SITE_URL=https://another.test\n");
  assert.equal(init(dir).status, 2); assert.equal(existsSync(path.join(dir, "lib")), false);
  const linkDir = scaffold(t), outside = scaffold(t); symlinkSync(outside, path.join(linkDir, "lib"));
  assert.equal(init(linkDir).status, 2); assert.equal(existsSync(path.join(outside, "dormsLogin.ts")), false);
  for (const target of [".env.local", "lib"]) {
    const dangling = scaffold(t), external = path.join(outside, `missing-${target.replaceAll(".", "")}`);
    symlinkSync(external, path.join(dangling, target));
    assert.equal(init(dangling).status, 2, `dangling ${target}`);
    assert.equal(existsSync(external), false, "must not create a file or directory outside the project");
  }
});

test("donations are opt-in, persist on upgrade, and customized logout is preserved", (t) => {
  const dir = scaffold(t); assert.equal(init(dir).status, 0);
  assert.equal(existsSync(path.join(dir, "lib/dormsDonation.ts")), false);
  const logout = path.join(dir, "app/api/auth/dorms/logout/route.ts");
  const custom = readFileSync(logout, "utf8") + "\n// custom logout behavior\n";
  writeFileSync(logout, custom);
  assert.equal(run(dir, "upgrade", "--donations", "--no-install").status, 1);
  assert.equal(readFileSync(logout, "utf8"), custom);
  assert.match(readFileSync(path.join(dir, ".dorms-login/review/app/api/auth/dorms/logout/route.ts"), "utf8"), /revokeDonation/);
  assert.equal(JSON.parse(readFileSync(path.join(dir, ".dorms-login.json"), "utf8")).donations, true);
  assert.equal(existsSync(path.join(dir, "components/DormsDonationButton.tsx")), true);
  assert.equal(run(dir, "upgrade", "--no-install").status, 1);
  assert.equal(existsSync(path.join(dir, "lib/dormsDonation.ts")), true);
});

test("--doreumi installs the outfit helper and routes, and upgrade keeps it", (t) => {
  const dir = scaffold(t, { src: true });
  assert.equal(init(dir).status, 0);
  assert.equal(existsSync(path.join(dir, "src/lib/dormsDoreumi.ts")), false, "outfit is opt-in");
  const result = run(dir, "upgrade", "--doreumi", "--no-install");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const route = path.join(dir, "src/app/api/auth/dorms/doreumi/items/[id]/route.ts");
  const imp = /from "([^"]*dormsDoreumi)"/.exec(readFileSync(route, "utf8"))[1];
  assert.ok(existsSync(path.resolve(path.dirname(route), imp) + ".ts"));
  assert.ok(existsSync(path.join(dir, "src/app/api/auth/dorms/doreumi/route.ts")));
  assert.equal(JSON.parse(readFileSync(path.join(dir, ".dorms-login.json"), "utf8")).doreumi, true);
  assert.equal(run(dir, "upgrade", "--no-install").status, 0);
  assert.ok(existsSync(path.join(dir, "src/lib/dormsDoreumi.ts")));
});
