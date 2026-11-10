import { randomUUID } from "node:crypto";
import {
  UPLOAD_POLICIES,
  checkHints,
  isUploadType,
  type CreateUploadRequest,
  type CreateUploadResponse,
  type UploadPolicy,
} from "@/lib/contracts";
import { debugToolsEnabled, issuanceRateLimit, storageConfig } from "@/lib/server/env";
import { handleError, json, jsonError, sameOrigin } from "@/lib/server/http";
import { takeToken } from "@/lib/server/rate-limit";
import { issueReceipt } from "@/lib/server/receipt";
import { issueBlobSas } from "@/lib/server/storage";

export const dynamic = "force-dynamic";

/** Extension comes from the allow-listed content type, never the filename. */
const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

/**
 * POST /api/uploads — authorise an upload and mint a one-blob, write-only,
 * short-lived user delegation SAS. No file bytes pass through this server.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return jsonError(403, "bad_origin", "Cross-origin request rejected");

  const body = (await req.json().catch(() => null)) as Partial<CreateUploadRequest> | null;
  if (!body || !isUploadType(body.uploadType)) {
    return jsonError(400, "invalid_upload_type", "uploadType must be one of: " + Object.keys(UPLOAD_POLICIES).join(", "));
  }
  if (typeof body.size !== "number" || typeof body.contentType !== "string") {
    return jsonError(400, "bad_request", "size (number) and contentType (string) are required");
  }

  const policy: UploadPolicy = UPLOAD_POLICIES[body.uploadType];

  // Spike-only overrides used by the diagnostics panel (expired SAS, size bypass).
  const debug = debugToolsEnabled() ? body.debug : undefined;
  const maxBytes = clamp(debug?.maxBytes, 1, policy.maxBytes) ?? policy.maxBytes;
  const ttlSeconds = clamp(debug?.ttlSeconds, 1, policy.sasTtlSeconds) ?? policy.sasTtlSeconds;

  const contentType = body.contentType.toLowerCase();
  const problem = checkHints(body.uploadType, body.size, contentType, maxBytes);
  if (problem) return jsonError(422, problem.code, problem.message);

  // No auth in this spike: the per-IP rate limit and same-origin check are the
  // only brakes on issuance. Use Vercel Deployment Protection if exposed widely.
  if (!takeToken(`issue:${clientIp(req)}`, issuanceRateLimit())) {
    return jsonError(429, "rate_limited", "Too many upload URLs requested; try again shortly");
  }

  try {
    const { containerName } = storageConfig();
    const id = randomUUID();
    const blobName = `${body.uploadType}/${id}.${EXTENSIONS[contentType] ?? "bin"}`;
    const { uploadUrl, expiresOn } = await issueBlobSas(containerName, blobName, ttlSeconds);
    const uploadId = issueReceipt({
      id,
      type: body.uploadType,
      container: containerName,
      blob: blobName,
      maxBytes,
    });

    // Log the issuance, never the URL.
    console.info(`[uploads] issued id=${id} type=${body.uploadType} hintBytes=${body.size} ttl=${ttlSeconds}s`);

    return json<CreateUploadResponse>(
      {
        uploadId,
        blobKey: `${containerName}/${blobName}`,
        uploadUrl,
        expiresAt: expiresOn.toISOString(),
        requiredHeaders: { "x-ms-blob-type": "BlockBlob" },
      },
      201,
    );
  } catch (err) {
    return handleError("uploads", err);
  }
}

function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

function clamp(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(Math.max(Math.floor(value), min), max);
}
