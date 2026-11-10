/**
 * Shared upload contract and policy. Safe to import from both client and
 * server code — contains no secrets.
 *
 * Browser-supplied size and MIME values are UNTRUSTED HINTS. The server uses
 * them only to reject obviously bad requests early; the authoritative checks
 * happen in `POST /api/uploads/:id/complete` against Blob Storage properties.
 */

export const MiB = 1024 * 1024;

export type Role = "uploader" | "viewer";

export interface UploadPolicy {
  label: string;
  /** Allowed MIME types (hints only — not proof of format). */
  contentTypes: readonly string[];
  /** `accept` attribute for the file input. */
  accept: string;
  maxBytes: number;
  /** Lifetime of the issued SAS. Must cover the whole transfer for block uploads. */
  sasTtlSeconds: number;
  allowedRoles: readonly Role[];
}

export const UPLOAD_POLICIES = {
  photo: {
    label: "Photo",
    contentTypes: [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
    ],
    accept: "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif",
    maxBytes: 25 * MiB,
    sasTtlSeconds: 10 * 60,
    allowedRoles: ["uploader"],
  },
  video: {
    label: "Video",
    contentTypes: ["video/mp4", "video/quicktime", "video/webm"],
    accept: "video/mp4,video/quicktime,video/webm,.mov",
    maxBytes: 2048 * MiB,
    sasTtlSeconds: 60 * 60,
    allowedRoles: ["uploader"],
  },
} as const satisfies Record<string, UploadPolicy>;

export type UploadType = keyof typeof UPLOAD_POLICIES;

export function isUploadType(value: unknown): value is UploadType {
  return typeof value === "string" && Object.hasOwn(UPLOAD_POLICIES, value);
}

/** Browsers often report an empty type for HEIC/MOV; fall back to extension. */
const EXTENSION_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

export function inferContentType(filename: string, reported: string): string {
  if (reported) return reported.toLowerCase();
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_TYPES[ext] ?? "application/octet-stream";
}

export type HintProblem =
  | { code: "unsupported_type"; message: string }
  | { code: "too_large"; message: string }
  | { code: "empty_file"; message: string };

/** Same check runs in the browser (fast feedback) and on the server (hint gate). */
export function checkHints(
  uploadType: UploadType,
  size: number,
  contentType: string,
  maxBytesOverride?: number,
): HintProblem | null {
  const policy: UploadPolicy = UPLOAD_POLICIES[uploadType];
  const maxBytes = maxBytesOverride ?? policy.maxBytes;
  if (!policy.contentTypes.includes(contentType)) {
    return {
      code: "unsupported_type",
      message: `${contentType || "unknown type"} is not allowed for ${policy.label.toLowerCase()} uploads`,
    };
  }
  if (!Number.isFinite(size) || size <= 0) {
    return { code: "empty_file", message: "File is empty" };
  }
  if (size > maxBytes) {
    return {
      code: "too_large",
      message: `File is ${formatBytes(size)}; limit is ${formatBytes(maxBytes)}`,
    };
  }
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MiB) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * MiB) return `${(bytes / MiB).toFixed(1)} MiB`;
  return `${(bytes / (1024 * MiB)).toFixed(2)} GiB`;
}

// ---------------------------------------------------------------------------
// API contract
// ---------------------------------------------------------------------------

export interface CreateUploadRequest {
  uploadType: UploadType;
  filename: string;
  size: number;
  contentType: string;
  /** Spike diagnostics only; ignored unless SPIKE_DEBUG_TOOLS=true. */
  debug?: { ttlSeconds?: number; maxBytes?: number };
}

export interface CreateUploadResponse {
  /** Signed receipt identifying the server-issued blob. Opaque to clients. */
  uploadId: string;
  /** `<container>/<blobName>` — server generated, never client supplied. */
  blobKey: string;
  /** Blob URL + user delegation SAS. A credential: never log or display. */
  uploadUrl: string;
  expiresAt: string;
  requiredHeaders: { "x-ms-blob-type": "BlockBlob" };
}

export interface CompleteUploadResponse {
  uploadId: string;
  blobKey: string;
  status: "accepted";
  size: number;
  /** Client-supplied metadata stored on the blob — not proof of format. */
  contentType: string | null;
}

export interface ApiError {
  error: string;
  message: string;
}

export interface SessionInfo {
  user: { id: string; role: Role } | null;
  debugTools: boolean;
}
