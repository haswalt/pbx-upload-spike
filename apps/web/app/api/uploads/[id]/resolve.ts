import { jsonError, sameOrigin } from "@/lib/server/http";
import { readReceipt, type UploadReceipt } from "@/lib/server/receipt";

/** Shared guard for per-upload routes: same-origin and a valid signed receipt. */
export async function resolveUpload(
  req: Request,
  id: string,
): Promise<{ receipt: UploadReceipt } | { error: Response }> {
  if (!sameOrigin(req)) return { error: jsonError(403, "bad_origin", "Cross-origin request rejected") };
  const receipt = readReceipt(decodeURIComponent(id));
  if (!receipt) return { error: jsonError(404, "unknown_upload", "Upload id is invalid or expired") };
  return { receipt };
}
