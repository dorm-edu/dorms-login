import { fetchDormsDoreumiItem } from "__DORMS_DOREUMI_IMPORT__";
export const dynamic = "force-dynamic";
/** Item .glb of the signed-in member's current outfit only. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return fetchDormsDoreumiItem(id);
}
