// Build real generated Next apps, including page and API authorization consumers.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const repo = fileURLToPath(new URL("../", import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(repo, "package.json"), "utf8"));
const dirs = [];
try {
  for (const [src, donations] of [[false, false], [true, false], [false, true], [true, true]]) {
    const dir = mkdtempSync(path.join(tmpdir(), "dorms-login-build-")); dirs.push(dir);
    const base = src ? "src/" : "";
    mkdirSync(path.join(dir, base, "app/members"), { recursive: true });
    mkdirSync(path.join(dir, base, "app/api/private"), { recursive: true });
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ private: true, scripts: { build: "next build" }, dependencies: { next: pkg.devDependencies.next, react: pkg.devDependencies.react, "react-dom": pkg.devDependencies["react-dom"], jose: pkg.devDependencies.jose }, devDependencies: { typescript: pkg.devDependencies.typescript, "@types/node": pkg.devDependencies["@types/node"], "@types/react": pkg.devDependencies["@types/react"] } }));
    writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2020", lib: ["dom", "dom.iterable", "esnext"], allowJs: true, skipLibCheck: true, strict: true, noEmit: true, esModuleInterop: true, module: "esnext", moduleResolution: "bundler", resolveJsonModule: true, isolatedModules: true, jsx: "preserve", incremental: true, plugins: [{ name: "next" }], paths: src ? { "@/components/*": ["./src/components/*"] } : { "@/*": ["./src/*"] } }, include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"], exclude: ["node_modules"] }));
    writeFileSync(path.join(dir, "next.config.mjs"), "export default { experimental: { cpus: 2 } };\n");
    symlinkSync(path.join(repo, "node_modules"), path.join(dir, "node_modules"));
    const init = spawnSync(process.execPath, [path.join(repo, "bin/dorms-login.js"), "init", "--client-id", "3b5f4d8c-7e2a-4c1b-9f0d-2a6e8c4b1d3e", "--site", "https://example.test", "--no-install", ...(donations ? ["--donations"] : []), "--dir", dir], { encoding: "utf8" });
    assert.equal(init.status, 0, init.stdout + init.stderr);
    writeFileSync(path.join(dir, base, "app/layout.tsx"), 'export default function Layout({children}:{children:React.ReactNode}) { return <html lang="ko"><body>{children}</body></html>; }');
    writeFileSync(path.join(dir, base, "app/page.tsx"), 'import { DormsLoginButton } from "../components/DormsLoginButton"; export default function Home() { return <DormsLoginButton next="/members"/>; }');
    writeFileSync(path.join(dir, base, "app/members/page.tsx"), 'import { requireDormsUser, dormsLogoutHref } from "../../lib/dormsLogin"; export const dynamic="force-dynamic"; export default async function Members(){ const user=await requireDormsUser({next:"/members"}); return <main>{user.name}<form method="post" action={dormsLogoutHref}><button>로그아웃</button></form></main>; }');
    writeFileSync(path.join(dir, base, "app/api/private/route.ts"), 'import { getDormsUser, DormsAuthError } from "../../../lib/dormsLogin"; export const dynamic="force-dynamic"; export async function GET(){ try { const user=await getDormsUser(); if(!user)return Response.json({reason:"authentication_required"},{status:401}); return Response.json({id:user.id}); } catch(error) { if(error instanceof DormsAuthError)return Response.json({reason:error.reason},{status:error.status}); throw error; } }');
    const build = spawnSync(process.execPath, [path.join(repo, "node_modules/next/dist/bin/next"), "build"], { cwd: dir, encoding: "utf8", timeout: 180_000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } });
    assert.equal(build.status, 0, `Generated ${src ? "src/app" : "app"} build failed\n${build.stdout}\n${build.stderr}`);
    if (donations && !src) {
      const port = 23100 + Math.floor(Math.random() * 1000);
      const server = spawn(process.execPath, [path.join(repo, "node_modules/next/dist/bin/next"), "start", "--port", String(port)], { cwd: dir, stdio: "ignore", env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", NODE_ENV: "production" } });
      try {
        const origin = `http://localhost:${port}`;
        let ready = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          try { await fetch(origin); ready = true; break; } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
        }
        assert.ok(ready, "generated production app starts");
        const base = `${origin}/api/auth/dorms/donation`;
        const blocked = await fetch(`${base}/send`, { method: "POST", headers: { Origin: "https://evil.test", "Content-Type": "application/json" }, body: "{}" });
        assert.equal(blocked.status, 403); assert.equal((await blocked.json()).reason, "forbidden");
        const status = await fetch(`${base}/status`);
        assert.equal(status.status, 401); assert.equal(status.headers.get("cache-control"), "no-store");
        const send = await fetch(`${base}/send`, { method: "POST", headers: { Origin: "https://example.test", "Content-Type": "application/json" }, body: JSON.stringify({ recipientId: "ab5f4d8c-7e2a-4c1b-9f0d-2a6e8c4b1d3e", amount: 1, requestId: "bb5f4d8c-7e2a-4c1b-9f0d-2a6e8c4b1d3e" }) });
        assert.equal(send.status, 401);
        const oversized = await fetch(`${base}/send`, { method: "POST", headers: { Origin: "https://example.test", "Content-Type": "application/json" }, body: "x".repeat(2049) });
        assert.equal(oversized.status, 400);
        const start = await fetch(`${base}/start`, { redirect: "manual" });
        assert.equal(start.status, 302); assert.ok(start.headers.get("location").includes("/dorms-donation-denied?reason=authentication_required"));
        const callback = await fetch(`${base}/callback?code=fake&state=fake`, { redirect: "manual" });
        assert.equal(callback.status, 302); assert.ok(callback.headers.get("set-cookie").includes("Max-Age=0"));
        const page = await fetch(`${origin}/dorms-donation-denied?reason=approval_required`);
        assert.equal(page.status, 200); assert.ok((await page.text()).includes("관리자가 승인하면"));
        console.log("PASS generated production HTTP: CSRF, missing auth, bounded request body, callback failure, approval explanation");
      } finally {
        server.kill("SIGTERM");
        await new Promise((resolve) => server.once("exit", resolve));
      }
    }
    console.log(`PASS generated ${src ? "src/app" : "app"} ${donations ? "donation + login" : "login"} production build, page/API authorization, conflicting alias configuration`);
  }
} finally { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); }
