import { NextResponse, type NextRequest } from "next/server";
import { beginDormsLogin, DormsAuthError, FLOW_COOKIE, safeDormsNext, sessionCookieOptions } from "__DORMS_LIB_IMPORT__";
import { beginDonationLogin, donationCookieOptions, DONATION_AT_LOGIN, DONATION_LOGIN_FLOW_COOKIE } from "__DORMS_DONATION_IMPORT__";

export const dynamic = "force-dynamic";
/** Installed with --donations-at-login, every login also asks DoRms for donation permission (v0.5.0). Otherwise this is the normal login. */
async function start(request: NextRequest) {
  try {
    const next = request.nextUrl.searchParams.get("next");
    const login = DONATION_AT_LOGIN
      ? await beginDonationLogin(request.url, next)
      : { ...(await beginDormsLogin(request.url, next)), donationFlow: null };
    const response = NextResponse.redirect(login.authorizeUrl, 302);
    response.cookies.set(login.cookie.name, login.cookie.value, sessionCookieOptions(login.cookie.maxAge));
    response.cookies.set(DONATION_LOGIN_FLOW_COOKIE, login.donationFlow ?? "", donationCookieOptions(login.donationFlow ? 600 : 0));
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    const url = new URL("/dorms-denied", request.url);
    url.searchParams.set("reason", error instanceof DormsAuthError ? error.reason : "temporarily_unavailable");
    url.searchParams.set("next", safeDormsNext(request.nextUrl.searchParams.get("next")));
    const response = NextResponse.redirect(url, 302);
    response.cookies.set(FLOW_COOKIE, "", { path: "/", maxAge: 0 });
    response.cookies.set(DONATION_LOGIN_FLOW_COOKIE, "", donationCookieOptions(0));
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}
export const GET = start;
export const POST = start;
