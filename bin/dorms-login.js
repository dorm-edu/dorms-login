#!/usr/bin/env node
// dorms-login CLI. 선생님의 AI 도구가 부른다: detect(프로젝트 파악) → init(파일 넣기) → doctor(점검).
// 비밀값을 만들지도 받지도 않는다. 도름스 /connect 에서 받은 사이트 id 와 사이트 주소만 파일에 적는다.
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(readFileSync(path.join(HERE, "..", "package.json"), "utf8"));
const TEMPLATE_ROOT = path.join(HERE, "..", "templates", "next-app");
const DISCOVERY_URL = "https://dorms.school/.well-known/openid-configuration";
const CONNECT_URL = "https://dorms.school/connect";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const [, , cmd = "help", ...args] = process.argv;
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d; };
const root = path.resolve(opt("dir", process.cwd()));
const say = (s = "") => console.log(s);

function readJson(p) { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } }

function detect() {
  const pkg = readJson(path.join(root, "package.json"));
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  const hasNext = !!deps.next;
  const srcApp = existsSync(path.join(root, "src", "app"));
  const app = existsSync(path.join(root, "app"));
  const pages = existsSync(path.join(root, "src", "pages")) || existsSync(path.join(root, "pages"));
  const appDir = srcApp ? "src/app" : app ? "app" : null;
  const base = srcApp ? "src" : "";
  const pm = existsSync(path.join(root, "pnpm-lock.yaml")) ? "pnpm" : existsSync(path.join(root, "yarn.lock")) ? "yarn" : existsSync(path.join(root, "bun.lockb")) || existsSync(path.join(root, "bun.lock")) ? "bun" : "npm";
  const tsconfig = readJson(path.join(root, "tsconfig.json"));
  const alias = tsconfig?.compilerOptions?.paths && Object.keys(tsconfig.compilerOptions.paths).some((k) => k.startsWith("@/"));
  return {
    pkg: !!pkg, hasNext, nextVersion: deps.next ?? null, appDir, pagesRouter: !!pages && !appDir, base, pm, alias: !!alias,
    hasJose: !!deps.jose, typescript: !!deps.typescript || existsSync(path.join(root, "tsconfig.json")),
    kind: !pkg ? "unknown" : hasNext && appDir ? "next-app" : hasNext ? "next-pages" : "other",
  };
}

function printDetect(d) {
  say(`dorms-login ${PKG.version} · 프로젝트: ${root}`);
  if (d.kind === "next-app") say(`  Next.js ${d.nextVersion} App Router (${d.appDir}). 자동 설치 가능.`);
  else if (d.kind === "next-pages") say("  Next.js Pages Router. 이 도구의 자동 설치는 App Router 전용이에요. docs/PROTOCOL.md 대로 붙여 주세요.");
  else if (d.kind === "other") say("  Next.js 프로젝트가 아니에요. docs/PROTOCOL.md 의 HTTP 계약으로 붙여 주세요(표준 OAuth 2.1 + PKCE).");
  else say("  package.json 이 없어요. 프로젝트 폴더에서 다시 실행해 주세요.");
  say(`  패키지 관리자: ${d.pm} · TypeScript: ${d.typescript ? "예" : "아니오"} · jose: ${d.hasJose ? "있음" : "없음(init 이 설치)"} · @/ 별칭: ${d.alias ? "있음" : "없음"}`);
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p)); else out.push(p);
  }
  return out;
}

function relImport(fromFile, toFileNoExt) {
  let rel = path.relative(path.dirname(fromFile), toFileNoExt).split(path.sep).join("/");
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel;
}

function init() {
  const d = detect();
  if (d.kind !== "next-app") { printDetect(d); say("\ninit 은 Next.js App Router 프로젝트에서만 파일을 넣어요. 다른 스택은 docs/PROTOCOL.md 를 보세요."); process.exit(2); }
  const clientId = opt("client-id", "");
  const site = (opt("site", "") || "").replace(/\/+$/, "");
  if (!UUID.test(clientId)) { say(`--client-id 가 필요해요(도름스 ${CONNECT_URL} 에서 받은 사이트 id).`); process.exit(2); }
  if (!/^https:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[^\s?#]*)?$/.test(site)) { say("--site 는 https:// 로 시작하는 배포 주소여야 해요."); process.exit(2); }
  const requireTeacher = flag("require-teacher");
  const minDorms = Math.max(0, Math.floor(Number(opt("min-dorms", "0")) || 0));
  const wantsEmail = flag("email");
  const force = flag("force");

  const libDir = path.join(root, d.base, "lib");
  const compDir = path.join(root, d.base, "components");
  const appDir = path.join(root, d.appDir);
  const targets = [];
  for (const file of walk(TEMPLATE_ROOT)) {
    const rel = path.relative(TEMPLATE_ROOT, file).split(path.sep).join("/");
    let dest;
    if (rel.startsWith("lib/")) dest = path.join(libDir, rel.slice(4));
    else if (rel.startsWith("components/")) dest = path.join(compDir, rel.slice(11));
    else if (rel.startsWith("app/")) dest = path.join(appDir, rel.slice(4));
    else continue;
    targets.push({ src: file, dest });
  }
  const libFile = path.join(libDir, "dormsLogin");
  const written = [], skipped = [];
  for (const { src, dest } of targets) {
    let text = readFileSync(src, "utf8")
      .replace(/__DORMS_REQUIRE_TEACHER__/g, String(requireTeacher))
      .replace(/__DORMS_MIN_DORMS__/g, String(minDorms))
      .replace(/__DORMS_WANTS_EMAIL__/g, String(wantsEmail))
      .replace(/__DORMS_LIB_IMPORT__/g, d.alias ? `@/lib/dormsLogin` : relImport(dest, libFile));
    if (existsSync(dest) && !force) {
      const shadow = path.join(root, ".dorms-login", path.relative(root, dest));
      mkdirSync(path.dirname(shadow), { recursive: true });
      writeFileSync(shadow, text);
      skipped.push(path.relative(root, dest));
      continue;
    }
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, text);
    written.push(path.relative(root, dest));
  }

  // 환경 변수: 비밀값이 아니다. 없는 줄만 덧붙인다.
  const envLines = [`DORMS_CLIENT_ID=${clientId}`, `DORMS_SITE_URL=${site}`];
  for (const envFile of [".env.local", ".env.example"]) {
    const p = path.join(root, envFile);
    const current = existsSync(p) ? readFileSync(p, "utf8") : "";
    const missing = envLines.filter((l) => !current.includes(l.split("=")[0] + "="));
    if (missing.length) appendFileSync(p, `${current && !current.endsWith("\n") ? "\n" : ""}# DoRms로 로그인 (dorms-login init). 비밀값 아님. 배포 환경에도 같은 값을 넣어 주세요.\n${missing.join("\n")}\n`);
  }
  const gi = path.join(root, ".gitignore");
  const giText = existsSync(gi) ? readFileSync(gi, "utf8") : "";
  if (!giText.split("\n").some((l) => l.trim() === ".dorms-login/" || l.trim() === ".dorms-login")) appendFileSync(gi, `${giText && !giText.endsWith("\n") ? "\n" : ""}.dorms-login/\n`);

  let installed = false;
  if (!d.hasJose && !flag("no-install")) {
    const cmds = { npm: ["npm", ["install", "jose"]], pnpm: ["pnpm", ["add", "jose"]], yarn: ["yarn", ["add", "jose"]], bun: ["bun", ["add", "jose"]] };
    const [bin, a] = cmds[d.pm];
    say(`jose 를 설치해요: ${bin} ${a.join(" ")}`);
    const r = spawnSync(bin, a, { cwd: root, stdio: "inherit" });
    installed = r.status === 0;
  }

  say("");
  say(`dorms-login ${PKG.version} · 넣은 파일 ${written.length}개${skipped.length ? ` · 건너뜀 ${skipped.length}개(.dorms-login/ 아래에 참고본)` : ""}`);
  for (const f of written) say(`  + ${f}`);
  for (const f of skipped) say(`  = ${f} (이미 있어서 그대로 둠, --force 로 덮어쓰기)`);
  say(`  + .env.local / .env.example 에 DORMS_CLIENT_ID, DORMS_SITE_URL`);
  if (!d.hasJose && !installed) say("  ! jose 설치가 안 됐어요. 직접 설치해 주세요: npm install jose");
  say("");
  say("다음 할 일");
  say("  1. 로그인 화면이나 첫 화면에 <DormsLoginButton /> 을 놓으세요 (components/DormsLoginButton.tsx).");
  say("  2. 로그인이 필요한 페이지(서버 컴포넌트)에서 const user = await requireDormsUser({ next: \"/그 페이지\" }); 를 부르세요.");
  say(`  3. 되돌아올 주소는 ${site}/api/auth/dorms/callback 이에요. 바꾸지 마세요. 로컬은 http://localhost:3000 도 돼요.`);
  say("  4. 배포 환경(Vercel 등)에도 DORMS_CLIENT_ID 와 DORMS_SITE_URL 을 넣으세요. 비밀값은 없어요.");
  say(`  5. 문(누가 들어올 수 있나)은 도름스 ${CONNECT_URL} 에서 언제든 바꿔요. 지금 값: 교사 인증 ${requireTeacher ? "필요" : "불필요"} · 최소 ${minDorms}도름${wantsEmail ? " · 이메일 받음" : ""}`);
}

async function doctor() {
  const d = detect();
  printDetect(d);
  const checks = [];
  const env = {};
  for (const f of [".env.local", ".env"]) {
    const p = path.join(root, f);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  const cid = process.env.DORMS_CLIENT_ID || env.DORMS_CLIENT_ID || "";
  const site = process.env.DORMS_SITE_URL || env.DORMS_SITE_URL || "";
  checks.push([UUID.test(cid), `DORMS_CLIENT_ID ${cid ? "있음" : "없음"}`]);
  checks.push([/^https:\/\//.test(site) && !/\/$/.test(site), `DORMS_SITE_URL ${site || "없음"}${/\/$/.test(site) ? " (끝의 / 를 지우세요)" : ""}`]);
  const need = ["lib/dormsLogin.ts", "components/DormsLoginButton.tsx", "api/auth/dorms/start/route.ts", "api/auth/dorms/callback/route.ts", "api/auth/dorms/logout/route.ts", "dorms-denied/page.tsx"];
  for (const rel of need) {
    const p = rel.startsWith("lib/") || rel.startsWith("components/") ? path.join(root, d.base, rel) : d.appDir ? path.join(root, d.appDir, rel) : null;
    checks.push([!!p && existsSync(p), `${rel} ${p && existsSync(p) ? "있음" : "없음"}`]);
  }
  checks.push([d.hasJose, `jose ${d.hasJose ? "설치됨" : "없음(npm install jose)"}`]);
  try {
    const r = await fetch(DISCOVERY_URL, { signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    checks.push([r.ok && j.token_endpoint === "https://dorms.school/api/sso/token", `도름스 검색 문서 ${r.status}`]);
  } catch (e) { checks.push([false, `도름스 검색 문서에 닿지 못함: ${e.message}`]); }
  say("");
  let bad = 0;
  for (const [ok, text] of checks) { if (!ok) bad++; say(`  ${ok ? "OK " : "!! "} ${text}`); }
  say("");
  if (bad) { say(`${bad}개를 고쳐야 해요. 되돌아올 주소가 도름스에 등록한 것과 같은지도 확인하세요: ${site}/api/auth/dorms/callback`); process.exit(1); }
  say("모두 좋아요. 버튼을 눌러 도름스 로그인 화면이 뜨고 돌아오는지 확인하세요.");
}

function help() {
  say(`dorms-login ${PKG.version} · 내 사이트에 "DoRms로 로그인" 달기 (${CONNECT_URL})

  detect                         프로젝트 종류를 알려줘요
  init --client-id <id> --site <https://주소> [--require-teacher] [--min-dorms N] [--email] [--force] [--no-install]
                                 Next.js App Router 에 로그인 파일을 넣어요
  doctor                         설정·파일·도름스 연결을 점검해요

  사이트 id 는 도름스 ${CONNECT_URL} 에서 받아요. 비밀값은 없어요. 다른 스택은 docs/PROTOCOL.md 를 보세요.`);
}

if (cmd === "detect") printDetect(detect());
else if (cmd === "init") init();
else if (cmd === "doctor") await doctor();
else if (cmd === "help" || cmd === "--help" || cmd === "-h") help();
else { say(`모르는 명령이에요: ${cmd}`); help(); process.exit(2); }
