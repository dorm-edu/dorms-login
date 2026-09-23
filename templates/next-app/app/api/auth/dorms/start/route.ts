import { NextResponse, type NextRequest } from "next/server";

import { beginDormsLogin } from "__DORMS_LIB_IMPORT__";

export const dynamic = "force-dynamic";

/** "DoRms로 로그인" 버튼이 여기로 온다. 임시 쿠키(state·PKCE)를 두고 도름스로 보낸다. */
async function start(request: NextRequest) {
  const next = request.nextUrl.searchParams.get("next");
  const { authorizeUrl, cookie } = await beginDormsLogin(request.url, next);
  const response = NextResponse.redirect(authorizeUrl, 302);
  response.cookies.set(cookie.name, cookie.value, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: cookie.maxAge });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export const GET = start;
export const POST = start;
