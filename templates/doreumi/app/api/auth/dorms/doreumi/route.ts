import { NextResponse } from "next/server";
import { getDormsDoreumi } from "__DORMS_DOREUMI_IMPORT__";
import { DormsAuthError } from "__DORMS_LIB_IMPORT__";
export const dynamic = "force-dynamic";
/** The signed-in member's Doreumi outfit for this browser ({ doreumi: null } when there is none to show). */
export async function GET() {
  try { return NextResponse.json({ doreumi: await getDormsDoreumi() }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) {
    const reason = error instanceof DormsAuthError ? error.reason : "temporarily_unavailable";
    return NextResponse.json({ reason }, { status: error instanceof DormsAuthError ? error.status : 503, headers: { "Cache-Control": "no-store" } });
  }
}
