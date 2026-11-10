import { getSession } from "@/lib/server/auth";
import { jsonError, sameOrigin } from "@/lib/server/http";
import { readReceipt, type UploadReceipt } from "@/lib/server/receipt";

/** Shared guard for per-upload routes: same-origin, signed in, owns receipt. */
export async function resolveUpload(
  req: Request,
  id: string,
): Promise<{ receipt: UploadReceipt } | { error: Response }> {
  if (!sameOrigin(req)) return { error: jsonError(403, "bad_origin", "Cross-origin request rejected") };
  const session = await getSession().catch(() => null);
  if (!session) return { error: jsonError(401, "unauthenticated", "Sign in first") };
  const receipt = readReceipt(decodeURIComponent(id));
  if (!receipt) return { error: jsonError(404, "unknown_upload", "Upload id is invalid or expired") };
  if (receipt.sub !== session.sub) {
    return { error: jsonError(403, "forbidden", "This upload belongs to another user") };
  }
  return { receipt };
}
