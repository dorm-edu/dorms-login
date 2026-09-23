import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE } from "__DORMS_LIB_IMPORT__";

export const dynamic = "force-dynamic";

/** 이 사이트의 로그인만 끝낸다(도름스 자체 로그인은 그대로). */
function logout(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/", request.url), 302);
  response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export const GET = logout;
export const POST = logout;
