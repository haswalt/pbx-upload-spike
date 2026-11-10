import { handleError, json } from "@/lib/server/http";
import { deleteBlob } from "@/lib/server/storage";
import { resolveUpload } from "./resolve";

export const dynamic = "force-dynamic";

/** DELETE /api/uploads/:id — owner cleanup of an uploaded blob. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const resolved = await resolveUpload(req, (await ctx.params).id);
  if ("error" in resolved) return resolved.error;
  const { receipt } = resolved;
  try {
    const deleted = await deleteBlob(receipt.container, receipt.blob);
    console.info(`[uploads] delete id=${receipt.id} deleted=${deleted}`);
    return json({ uploadId: receipt.id, deleted });
  } catch (err) {
    return handleError("delete", err);
  }
}
