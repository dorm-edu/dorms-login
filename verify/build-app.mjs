// Build real generated Next apps, including page and API authorization consumers.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const repo = fileURLToPath(new URL("../", import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(repo, "package.json"), "utf8"));
const dirs = [];
try {
  for (const src of [false, true]) {
    const dir = mkdtempSync(path.join(tmpdir(), "dorms-login-build-")); dirs.push(dir);
    const base = src ? "src/" : "";
    mkdirSync(path.join(dir, base, "app/members"), { recursive: true });
    mkdirSync(path.join(dir, base, "app/api/private"), { recursive: true });
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ private: true, scripts: { build: "next build" }, dependencies: { next: pkg.devDependencies.next, react: pkg.devDependencies.react, "react-dom": pkg.devDependencies["react-dom"], jose: pkg.devDependencies.jose }, devDependencies: { typescript: pkg.devDependencies.typescript, "@types/node": pkg.devDependencies["@types/node"], "@types/react": pkg.devDependencies["@types/react"] } }));
    writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2020", lib: ["dom", "dom.iterable", "esnext"], allowJs: true, skipLibCheck: true, strict: true, noEmit: true, esModuleInterop: true, module: "esnext", moduleResolution: "bundler", resolveJsonModule: true, isolatedModules: true, jsx: "preserve", incremental: true, plugins: [{ name: "next" }], paths: src ? { "@/components/*": ["./src/components/*"] } : { "@/*": ["./src/*"] } }, include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"], exclude: ["node_modules"] }));
    writeFileSync(path.join(dir, "next.config.mjs"), "export default { experimental: { cpus: 2 } };\n");
    symlinkSync(path.join(repo, "node_modules"), path.join(dir, "node_modules"));
    const init = spawnSync(process.execPath, [path.join(repo, "bin/dorms-login.js"), "init", "--client-id", "3b5f4d8c-7e2a-4c1b-9f0d-2a6e8c4b1d3e", "--site", "https://example.test", "--no-install", "--dir", dir], { encoding: "utf8" });
    assert.equal(init.status, 0, init.stdout + init.stderr);
    writeFileSync(path.join(dir, base, "app/layout.tsx"), 'export default function Layout({children}:{children:React.ReactNode}) { return <html lang="ko"><body>{children}</body></html>; }');
    writeFileSync(path.join(dir, base, "app/page.tsx"), 'import { DormsLoginButton } from "../components/DormsLoginButton"; export default function Home() { return <DormsLoginButton next="/members"/>; }');
    writeFileSync(path.join(dir, base, "app/members/page.tsx"), 'import { requireDormsUser, dormsLogoutHref } from "../../lib/dormsLogin"; export const dynamic="force-dynamic"; export default async function Members(){ const user=await requireDormsUser({next:"/members"}); return <main>{user.name}<form method="post" action={dormsLogoutHref}><button>로그아웃</button></form></main>; }');
    writeFileSync(path.join(dir, base, "app/api/private/route.ts"), 'import { getDormsUser, DormsAuthError } from "../../../lib/dormsLogin"; export const dynamic="force-dynamic"; export async function GET(){ try { const user=await getDormsUser(); if(!user)return Response.json({reason:"authentication_required"},{status:401}); return Response.json({id:user.id}); } catch(error) { if(error instanceof DormsAuthError)return Response.json({reason:error.reason},{status:error.status}); throw error; } }');
    const build = spawnSync(process.execPath, [path.join(repo, "node_modules/next/dist/bin/next"), "build"], { cwd: dir, encoding: "utf8", timeout: 180_000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } });
    assert.equal(build.status, 0, `Generated ${src ? "src/app" : "app"} build failed\n${build.stdout}\n${build.stderr}`);
    console.log(`PASS generated ${src ? "src/app" : "app"} production build, page/API authorization, conflicting alias configuration`);
  }
} finally { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); }
