#!/usr/bin/env node
// Install/update public client-side integration files. No shell interpolation or secrets.
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, appendFileSync, lstatSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(readFileSync(path.join(HERE, "..", "package.json"), "utf8"));
const TEMPLATE_ROOT = path.join(HERE, "..", "templates", "next-app");
const CONNECT_URL = "https://dorms.school/connect";
const PROTOCOL_URL = `https://github.com/shinnanchanguk/dorms-login/blob/v${PKG.version}/docs/PROTOCOL.md`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const [, , command = "help", ...args] = process.argv;
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback; };
const root = path.resolve(opt("dir", process.cwd()));
const manifestPath = path.join(root, ".dorms-login.json");
const say = (text = "") => console.log(text);
const hash = (text) => createHash("sha256").update(text).digest("hex");
const json = (file) => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; } };
const fail = (text) => { throw new Error(text); };

function detect() {
  const pkg = json(path.join(root, "package.json"));
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  const hasNext = !!deps.next;
  const appDir = existsSync(path.join(root, "app")) ? "app" : existsSync(path.join(root, "src/app")) ? "src/app" : null;
  const base = appDir === "src/app" ? "src" : "";
  const typescript = existsSync(path.join(root, "tsconfig.json"));
  const major = Number(/(?:^|[^\d])(\d+)\./.exec(deps.next ?? "")?.[1]);
  const pm = existsSync(path.join(root, "pnpm-lock.yaml")) ? "pnpm" : existsSync(path.join(root, "yarn.lock")) ? "yarn" : existsSync(path.join(root, "bun.lock")) || existsSync(path.join(root, "bun.lockb")) ? "bun" : "npm";
  const nextConfigs = ["next.config.js", "next.config.mjs", "next.config.ts", "next.config.cjs"].filter((f) => existsSync(path.join(root, f)));
  const basePath = nextConfigs.some((f) => /\bbasePath\b/.test(readFileSync(path.join(root, f), "utf8")));
  return { pkg: !!pkg, hasNext, nextVersion: deps.next ?? null, appDir, base, pm, hasJose: !!deps.jose, typescript, basePath,
    supported: hasNext && !!appDir && major >= 15 && typescript && !basePath,
    kind: !pkg ? "unknown" : hasNext && appDir ? "next-app" : hasNext ? "next-pages" : "other" };
}
function printDetect(d) {
  say(`dorms-login ${PKG.version} · 프로젝트: ${root}`);
  say(`  ${d.hasNext ? `Next.js ${d.nextVersion} ${d.appDir ? `App Router (${d.appDir})` : "Pages Router"}` : d.pkg ? "다른 웹 프로젝트" : "package.json 없음"}`);
  say(`  자동 설치: ${d.supported ? "가능(TypeScript, Next.js 15 이상, 도메인 첫 경로)" : "지원 범위 밖"} · 패키지 관리자: ${d.pm}`);
  if (!d.supported) say(`  자동 설치는 TypeScript를 쓰는 Next.js 15 이상 App Router 전용이에요. 하위 경로(basePath) 배포는 지원하지 않아요. 다른 프로젝트 안내: ${PROTOCOL_URL}`);
}
function siteOrigin(raw) {
  try {
    if (typeof raw !== "string" || raw.length > 300 || !/^https:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?\/?$/.test(raw)) return null;
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash || url.hostname.endsWith(".")) return null;
    return url.origin;
  } catch { return null; }
}
function envValues(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    const raw = match[2];
    values[match[1]] = raw.startsWith('"') || raw.startsWith("'") ? raw.slice(1, raw.lastIndexOf(raw[0])) : raw.replace(/\s*#.*$/, "").trim();
  }
  return values;
}
function localEnv() {
  let env = {};
  for (const f of [".env", ".env.local"]) {
    const p = path.join(root, f);
    if (existsSync(p)) env = { ...env, ...envValues(readFileSync(p, "utf8")) };
  }
  return { ...env, ...(process.env.DORMS_CLIENT_ID ? { DORMS_CLIENT_ID: process.env.DORMS_CLIENT_ID } : {}), ...(process.env.DORMS_SITE_URL ? { DORMS_SITE_URL: process.env.DORMS_SITE_URL } : {}) };
}
function safeWritePath(file) {
  // Never follow a project symlink when modifying generated files or metadata.
  const rel = path.relative(root, file);
  if (rel.startsWith("..") || path.isAbsolute(rel)) fail("프로젝트 밖의 파일에는 쓸 수 없어요.");
  let cursor = root;
  for (const part of rel.split(path.sep)) {
    cursor = path.join(cursor, part);
    if (lstatSync(cursor, { throwIfNoEntry: false })?.isSymbolicLink()) fail(`심볼릭 링크는 자동으로 바꾸지 않아요: ${path.relative(root, cursor)}`);
  }
}
function walk(dir) {
  return readdirSync(dir).flatMap((name) => { const p = path.join(dir, name); return statSync(p).isDirectory() ? walk(p) : [p]; });
}
function targets(d, donations = false, doreumi = false) {
  const libFile = path.join(root, d.base, "lib/dormsLogin");
  const sources = new Map(walk(TEMPLATE_ROOT).map((src) => [path.relative(TEMPLATE_ROOT, src), src]));
  for (const [enabled, folder] of [[donations, "donation"], [doreumi, "doreumi"]]) {
    if (!enabled) continue;
    const extra = path.join(HERE, "..", "templates", folder);
    for (const src of walk(extra)) sources.set(path.relative(extra, src), src);
  }
  return [...sources].map(([rel, src]) => {
    const dest = rel.startsWith(`app${path.sep}`) ? path.join(root, d.appDir, rel.slice(4)) : path.join(root, d.base, rel);
    let imp = path.relative(path.dirname(dest), libFile).split(path.sep).join("/");
    if (!imp.startsWith(".")) imp = `./${imp}`;
    let donationImp = path.relative(path.dirname(dest), path.join(root, d.base, "lib/dormsDonation")).split(path.sep).join("/");
    if (!donationImp.startsWith(".")) donationImp = `./${donationImp}`;
    let doreumiImp = path.relative(path.dirname(dest), path.join(root, d.base, "lib/dormsDoreumi")).split(path.sep).join("/");
    if (!doreumiImp.startsWith(".")) doreumiImp = `./${doreumiImp}`;
    return { dest, rel: path.relative(root, dest).split(path.sep).join("/"), text: readFileSync(src, "utf8").replaceAll("__DORMS_LIB_IMPORT__", imp).replaceAll("__DORMS_DONATION_IMPORT__", donationImp).replaceAll("__DORMS_DOREUMI_IMPORT__", doreumiImp) };
  });
}
function ensureEnv(filename, id, site) {
  const p = path.join(root, filename);
  const current = existsSync(p) ? readFileSync(p, "utf8") : "";
  const parsed = envValues(current);
  const missing = Object.entries({ DORMS_CLIENT_ID: id, DORMS_SITE_URL: site }).filter(([key]) => !parsed[key]);
  if (missing.length) appendFileSync(p, `${current && !current.endsWith("\n") ? "\n" : ""}# DoRms login. Public values; set these in your hosting environment too.\n${missing.map(([k, v]) => `${k}=${v}`).join("\n")}\n`);
}
function install(upgrade) {
  const d = detect();
  if (!d.supported) { printDetect(d); fail("이 프로젝트에는 자동으로 파일을 넣지 않았어요."); }
  if (flag("force")) fail("파일을 강제로 덮어쓰지 않아요. upgrade가 만든 참고본과 비교해 수정 내용을 합쳐 주세요.");
  if (["require-teacher", "min-dorms", "email"].some(flag)) say("입장 조건과 이메일 전달 여부는 도름스의 현재 설정을 읽어요. 예전 설치 옵션은 코드에 복사하지 않아요.");
  const env = localEnv();
  const id = opt("client-id", env.DORMS_CLIENT_ID ?? "");
  const site = siteOrigin(opt("site", env.DORMS_SITE_URL ?? ""));
  if (!UUID.test(id)) fail(`--client-id가 필요해요. ${CONNECT_URL}에서 받은 사이트 id를 사용해 주세요.`);
  if (!site) fail("--site에는 https://example.com처럼 도메인 주소만 넣어 주세요. /my-app 같은 하위 경로와 명령 기호는 자동 설치에서 지원하지 않아요.");
  if (env.DORMS_CLIENT_ID && env.DORMS_CLIENT_ID !== id) fail("기존 DORMS_CLIENT_ID가 달라요. 어느 사이트를 연결할지 먼저 확인해 주세요.");
  if (env.DORMS_SITE_URL && siteOrigin(env.DORMS_SITE_URL) !== site) fail("기존 DORMS_SITE_URL이 달라요. 기존 설정을 확인해 주세요.");
  const previous = json(manifestPath);
  const donations = flag("donations") || previous?.donations === true;
  const doreumi = flag("doreumi") || previous?.doreumi === true;
  const files = targets(d, donations, doreumi);
  if (existsSync(manifestPath) && (!previous || previous.schemaVersion !== 1 || !previous.files || typeof previous.files !== "object")) fail(".dorms-login.json을 읽지 못했어요. 설치 기록을 확인한 뒤 다시 실행해 주세요.");
  for (const p of [...files.map((f) => f.dest), manifestPath, path.join(root, ".env.local"), path.join(root, ".env.example"), path.join(root, ".gitignore"), path.join(root, ".dorms-login/review")]) safeWritePath(p);
  const hashes = { ...previous?.files };
  const pending = [], written = [];
  for (const file of files) {
    const current = existsSync(file.dest) ? readFileSync(file.dest, "utf8") : null;
    if (current === file.text) { hashes[file.rel] = hash(file.text); continue; }
    const owned = current !== null && previous?.files?.[file.rel] === hash(current);
    if (current !== null && !(upgrade && owned)) {
      const candidate = path.join(root, ".dorms-login/review", file.rel);
      safeWritePath(candidate); safeWritePath(`${candidate}.diff`);
      mkdirSync(path.dirname(candidate), { recursive: true });
      writeFileSync(candidate, file.text);
      const diff = spawnSync("git", ["--no-pager", "-c", "core.fsmonitor=false", "diff", "--no-index", "--no-ext-diff", "--no-textconv", "--no-color", "--", file.dest, candidate], { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
      if (diff.status === 1 && diff.stdout) writeFileSync(`${candidate}.diff`, diff.stdout);
      if (upgrade && flag("accept-reviewed")) {
        // Record the upstream reference, not the customized file. Future upgrades still preserve custom changes.
        hashes[file.rel] = hash(file.text);
        say(`  검토 완료로 기록: ${file.rel} (직접 수정한 파일은 그대로 보존)`);
      } else pending.push(file.rel);
      continue;
    }
    mkdirSync(path.dirname(file.dest), { recursive: true });
    writeFileSync(file.dest, file.text);
    hashes[file.rel] = hash(file.text); written.push(file.rel);
  }
  ensureEnv(".env.local", id, site); ensureEnv(".env.example", id, site);
  const gi = path.join(root, ".gitignore");
  let giText = existsSync(gi) ? readFileSync(gi, "utf8") : "";
  for (const line of [".dorms-login/", ".env.local"]) if (!giText.split(/\r?\n/).includes(line)) giText += `${giText && !giText.endsWith("\n") ? "\n" : ""}${line}\n`;
  writeFileSync(gi, giText);
  writeFileSync(manifestPath, JSON.stringify({ schemaVersion: 1, donations, doreumi, version: pending.length ? previous?.version ?? null : PKG.version, targetVersion: PKG.version, files: hashes, pending }, null, 2) + "\n");
  if (!d.hasJose && !flag("no-install")) {
    const bins = { npm: ["npm", ["install", "jose@^6.2.3"]], pnpm: ["pnpm", ["add", "jose@^6.2.3"]], yarn: ["yarn", ["add", "jose@^6.2.3"]], bun: ["bun", ["add", "jose@^6.2.3"]] };
    const [bin, argv] = bins[d.pm];
    if (spawnSync(bin, argv, { cwd: root, stdio: "inherit" }).status !== 0) fail("jose 설치가 끝나지 않았어요. 패키지 관리자 오류를 확인한 뒤 다시 실행해 주세요.");
  }
  say(`dorms-login ${PKG.version} · ${upgrade ? "업데이트" : "설치"} 파일 ${written.length}개 · 직접 확인할 파일 ${pending.length}개`);
  for (const rel of written) say(`  + ${rel}`);
  for (const rel of pending) say(`  확인 필요: ${rel} (.dorms-login/review/ 안의 참고본·차이 파일)`);
  if (pending.length) say("기존 파일은 보존했어요. AI에게 참고본의 보안 변경을 기존 수정과 합쳐 달라고 요청하세요. v0.1.0에는 설치 기록이 없어 자동으로 덮어쓰지 않아요.");
  say("페이지뿐 아니라 자료를 읽거나 저장하는 모든 서버 경로에서도 getDormsUser()를 확인하세요. 오류가 나면 예전 로그인 정보로 계속 진행하면 안 돼요.");
  say("버튼 배치 → doctor → 프로젝트 빌드 → 실제 로그인·연결 끊기 검증까지 마쳐 주세요.");
  if (!d.hasJose && flag("no-install")) say("의존성 설치를 건너뛰었어요. jose 6.x를 설치한 뒤 빌드해 주세요.");
  if (pending.length) process.exitCode = 1;
}
async function doctor() {
  const d = detect(); printDetect(d);
  const env = localEnv(), id = env.DORMS_CLIENT_ID ?? "", site = siteOrigin(env.DORMS_SITE_URL ?? "");
  const checks = [[d.supported, "자동 설치 지원 범위"], [UUID.test(id), "사이트 id"], [!!site, "도메인 주소"], [d.hasJose, "jose 의존성"]];
  if (d.appDir) for (const f of targets(d, json(manifestPath)?.donations === true, json(manifestPath)?.doreumi === true)) checks.push([existsSync(f.dest), f.rel]);
  const record = json(manifestPath);
  checks.push([record?.version === PKG.version && Array.isArray(record?.pending) && record.pending.length === 0, `설치 기록 ${record?.version ?? "없음"}, 목표 ${PKG.version}`]);
  if (UUID.test(id) && site) {
    try {
      const url = new URL(`https://dorms.school/api/sso/clients/${encodeURIComponent(id)}/configuration`);
      url.searchParams.set("redirect_uri", `${site}/api/auth/dorms/callback`);
      const r = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8000) });
      const body = await r.json();
      if (record?.donations === true) checks.push([body.donations?.status === "approved", `도름네이션 승인: ${body.donations?.status ?? "확인 불가"}. 아직 신청하지 않았다면 ${CONNECT_URL}의 해당 앱 카드에서 도름네이션 설치 프롬프트를 복사해 주세요. 복사하면 자동으로 신청돼요. 설치 명령만으로는 신청되지 않으며 관리자 승인 후 보낼 수 있어요. 이용자 동의는 각 이용자의 첫 사용 시 확인해요.`]);
      if (record?.doreumi === true) checks.push([body.doreumi === true, `도름이 착장 받기: ${body.doreumi === true ? "켜짐" : "꺼짐"}. ${CONNECT_URL}의 해당 앱 카드에서 '누가 들어올지 바꾸기'를 열어 '도름이 착장도 받기'를 켜 주세요. 이미 로그인해 있던 회원은 한 번 다시 로그인해야 착장이 와요.`]);
      checks.push([r.ok && body.active === true && Array.isArray(body.scopes), `도름스 등록·되돌아올 주소 확인 (${r.status})`]);
    } catch { checks.push([false, "도름스에 연결하지 못했어요. 잠시 뒤 다시 확인해 주세요."]); }
  }
  for (const [ok, label] of checks) say(`  ${ok ? "OK" : "!!"} ${label}`);
  if (checks.some(([ok]) => !ok)) { process.exitCode = 1; return; }
  say("기본 설정을 확인했어요. 실제 로그인·로그아웃·연결 끊기와 프로젝트 빌드는 별도로 확인해야 해요.");
}
function help() {
  say(`dorms-login ${PKG.version}\n\n  detect\n  init --client-id <id> --site <https://domain> [--no-install] [--donations] [--doreumi]\n  upgrade [--client-id <id>] [--site <https://domain>] [--no-install] [--donations] [--doreumi]\n  upgrade --donations           기존 로그인에 도름네이션 추가\n  upgrade --doreumi             기존 로그인에 도름이 착장 불러오기 추가\n  upgrade --accept-reviewed     참고본의 변경을 직접 합치고 검증한 뒤 검토 완료 기록\n  doctor\n\n기존 파일을 덮어쓰지 않아요. upgrade는 설치 기록과 일치하는 파일만 바꾸고, 수정된 파일은 .dorms-login/review/에 참고본과 차이를 남겨요.\n사이트 등록: ${CONNECT_URL}\n다른 스택: ${PROTOCOL_URL}`);
}
try {
  if (command === "detect") printDetect(detect());
  else if (command === "init") install(false);
  else if (command === "upgrade") install(true);
  else if (command === "doctor") await doctor();
  else if (["help", "--help", "-h"].includes(command)) help();
  else fail("모르는 명령이에요. help로 사용법을 확인해 주세요.");
} catch (error) { console.error(error.message); process.exitCode = 2; }
