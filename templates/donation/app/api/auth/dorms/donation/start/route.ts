import { NextResponse, type NextRequest } from "next/server";
import { beginDonation, donationCookieOptions, DONATION_FLOW_COOKIE, DormsDonationError } from "__DORMS_DONATION_IMPORT__";
import { DormsAuthError } from "__DORMS_LIB_IMPORT__";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const flow = await beginDonation(request.url, request.nextUrl.searchParams.get("next"));
    const response = NextResponse.redirect(flow.authorizeUrl, 302);
    response.cookies.set(DONATION_FLOW_COOKIE, flow.flow, donationCookieOptions(600));
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch (error) {
    const known = error instanceof DormsDonationError || error instanceof DormsAuthError;
    const target = new URL("/dorms-donation-denied", request.url);
    target.searchParams.set("reason", known ? error.reason : "temporarily_unavailable");
    return NextResponse.redirect(target, { status: 302, headers: { "Cache-Control": "no-store" } });
  }
}
