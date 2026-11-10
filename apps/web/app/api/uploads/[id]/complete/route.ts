import type { CompleteUploadResponse } from "@/lib/contracts";
import { handleError, json, jsonError } from "@/lib/server/http";
import { blobProperties, deleteBlob } from "@/lib/server/storage";
import { resolveUpload } from "../resolve";

export const dynamic = "force-dynamic";

/**
 * POST /api/uploads/:id/complete — one-shot metadata check.
 * Reads blob properties (HEAD); never downloads content. Confirms existence
 * and actual byte length. Content type is client-set metadata, not proof of
 * format. This does NOT certify the file as safe.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const resolved = await resolveUpload(req, (await ctx.params).id);
  if ("error" in resolved) return resolved.error;
  const { receipt } = resolved;
  const blobKey = `${receipt.container}/${receipt.blob}`;

  try {
    const props = await blobProperties(receipt.container, receipt.blob);
    if (!props) {
      return jsonError(404, "blob_missing", "No blob found — the upload did not complete");
    }
    if (props.size === 0 || props.size > receipt.maxBytes) {
      // Reject and clean up so oversized bytes don't linger in `incoming`.
      await deleteBlob(receipt.container, receipt.blob);
      console.warn(`[complete] rejected id=${receipt.id} size=${props.size} max=${receipt.maxBytes}`);
      return jsonError(
        422,
        props.size === 0 ? "empty_blob" : "blob_too_large",
        `Stored blob is ${props.size} bytes; limit is ${receipt.maxBytes}. It has been deleted.`,
      );
    }
    console.info(`[complete] accepted id=${receipt.id} size=${props.size}`);
    return json<CompleteUploadResponse>({
      uploadId: receipt.id,
      blobKey,
      status: "accepted",
      size: props.size,
      contentType: props.contentType,
    });
  } catch (err) {
    return handleError("complete", err);
  }
}
