import { NextResponse, type NextRequest } from "next/server";
import { DormsAuthError, finishDormsLogin, parseFlowCookie, safeDormsNext, sessionCookieOptions, FLOW_COOKIE, SESSION_COOKIE } from "__DORMS_LIB_IMPORT__";
import { finishDonationLogin, donationCookieOptions, DONATION_COOKIE, DONATION_LOGIN_FLOW_COOKIE } from "__DORMS_DONATION_IMPORT__";

export const dynamic = "force-dynamic";
function fail(request: NextRequest, reason: string, next = "/") {
  const url = new URL("/dorms-denied", request.url);
  url.searchParams.set("reason", reason);
  url.searchParams.set("next", safeDormsNext(next));
  const response = NextResponse.redirect(url, 302);
  response.cookies.set(FLOW_COOKIE, "", { path: "/", maxAge: 0 });
  response.cookies.set(DONATION_LOGIN_FLOW_COOKIE, "", donationCookieOptions(0));
  response.headers.set("Cache-Control", "no-store");
  return response;
}
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const flow = parseFlowCookie(request.cookies.get(FLOW_COOKIE)?.value);
  if (!flow || params.get("state") !== flow.state) return fail(request, "authentication_required");
  if (params.has("error")) return fail(request, params.get("error") === "temporarily_unavailable" ? "temporarily_unavailable" : "access_denied", flow.next);
  const code = params.get("code");
  if (!code) return fail(request, "authentication_required", flow.next);
  try {
    const { idToken, expiresAt, subject } = await finishDormsLogin({ code, verifier: flow.verifier, nonce: flow.nonce, requestUrl: request.url });
    const target = new URL(safeDormsNext(flow.next), request.url);
    const response = NextResponse.redirect(target.origin === new URL(request.url).origin ? target : new URL("/", request.url), 302);
    response.cookies.set(SESSION_COOKIE, idToken, sessionCookieOptions(expiresAt - Math.floor(Date.now() / 1000)));
    response.cookies.set(FLOW_COOKIE, "", { path: "/", maxAge: 0 });
    // Donation permission that came back with this login (v0.5.0). Any failure here keeps the login; sends ask again later.
    const donationFlow = request.cookies.get(DONATION_LOGIN_FLOW_COOKIE)?.value;
    if (donationFlow) {
      if (params.get("donation_code")) {
        try {
          const pass = await finishDonationLogin(request.url, { idToken, subject, expiresAt, state: params.get("state"), code: params.get("donation_code"), flow: donationFlow });
          response.cookies.set(DONATION_COOKIE, pass.value, donationCookieOptions(pass.maxAge));
        } catch { /* login stays signed in without donation permission */ }
      }
      response.cookies.set(DONATION_LOGIN_FLOW_COOKIE, "", donationCookieOptions(0));
    }
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) { return fail(request, error instanceof DormsAuthError ? error.reason : "temporarily_unavailable", flow.next); }
}
