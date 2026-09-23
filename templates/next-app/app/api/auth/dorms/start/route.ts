import { NextResponse, type NextRequest } from "next/server";
import { beginDormsLogin, DormsAuthError, FLOW_COOKIE, safeDormsNext, sessionCookieOptions } from "__DORMS_LIB_IMPORT__";

export const dynamic = "force-dynamic";
async function start(request: NextRequest) {
  try {
    const { authorizeUrl, cookie } = await beginDormsLogin(request.url, request.nextUrl.searchParams.get("next"));
    const response = NextResponse.redirect(authorizeUrl, 302);
    response.cookies.set(cookie.name, cookie.value, sessionCookieOptions(cookie.maxAge));
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    const url = new URL("/dorms-denied", request.url);
    url.searchParams.set("reason", error instanceof DormsAuthError ? error.reason : "temporarily_unavailable");
    url.searchParams.set("next", safeDormsNext(request.nextUrl.searchParams.get("next")));
    const response = NextResponse.redirect(url, 302);
    response.cookies.set(FLOW_COOKIE, "", { path: "/", maxAge: 0 });
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}
export const GET = start;
export const POST = start;
