import { NextResponse, type NextRequest } from "next/server";
import { finishDonation, donationCookieOptions, DONATION_COOKIE, DONATION_FLOW_COOKIE, DormsDonationError } from "__DORMS_DONATION_IMPORT__";
import { DormsAuthError } from "__DORMS_LIB_IMPORT__";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  let response: NextResponse;
  try {
    const result = await finishDonation(request.url, request.nextUrl.searchParams.get("code"), request.nextUrl.searchParams.get("state"), request.cookies.get(DONATION_FLOW_COOKIE)?.value, request.nextUrl.searchParams.get("error"));
    response = NextResponse.redirect(new URL(result.next, request.url), 302);
    response.cookies.set(DONATION_COOKIE, result.value, donationCookieOptions(result.maxAge));
  } catch (error) {
    const known = error instanceof DormsDonationError || error instanceof DormsAuthError;
    const target = new URL("/dorms-donation-denied", request.url);
    target.searchParams.set("reason", known ? error.reason : "temporarily_unavailable");
    response = NextResponse.redirect(target, 302);
  }
  response.cookies.set(DONATION_FLOW_COOKIE, "", donationCookieOptions(0));
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
