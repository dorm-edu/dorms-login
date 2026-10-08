import { NextResponse, type NextRequest } from "next/server";
import { sendDonation, assertDonationOrigin, DormsDonationError } from "__DORMS_DONATION_IMPORT__";
import { DormsAuthError } from "__DORMS_LIB_IMPORT__";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  try {
    await assertDonationOrigin();
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new DormsDonationError("invalid_request", 400);
    const reader = request.body?.getReader();
    if (!reader) throw new DormsDonationError("invalid_request", 400);
    let size = 0; const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 2048) { await reader.cancel(); throw new DormsDonationError("invalid_request", 400); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const text = Buffer.concat(chunks).toString("utf8");
    let input;
    try { input = JSON.parse(text); } catch { throw new DormsDonationError("invalid_request", 400); }
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new DormsDonationError("invalid_request", 400);
    return NextResponse.json(await sendDonation({ recipientId: input.recipientId, amount: input.amount, requestId: input.requestId }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const known = error instanceof DormsDonationError || error instanceof DormsAuthError;
    return NextResponse.json({ reason: known ? error.reason : "temporarily_unavailable" }, { status: known ? error.status : 503, headers: { "Cache-Control": "no-store" } });
  }
}
