import { NextResponse } from "next/server";
import { getDonationStatus, DormsDonationError } from "__DORMS_DONATION_IMPORT__";
import { DormsAuthError } from "__DORMS_LIB_IMPORT__";
export const dynamic = "force-dynamic";
export async function GET() {
  try { return NextResponse.json(await getDonationStatus(), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) {
    const known = error instanceof DormsDonationError || error instanceof DormsAuthError;
    return NextResponse.json({ reason: known ? error.reason : "temporarily_unavailable" }, { status: known ? error.status : 503, headers: { "Cache-Control": "no-store" } });
  }
}
