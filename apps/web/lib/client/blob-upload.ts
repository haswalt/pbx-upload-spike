import { BlockBlobClient } from "@azure/storage-blob";
import { MiB } from "@/lib/contracts";

/**
 * Upload a File straight to Blob Storage using the SAS URL.
 * Small files: single Put Blob. Large files: parallel Put Block + Put Block
 * List, each request authorised by the same SAS (so the SAS must outlive the
 * transfer). `If-None-Match: *` makes the final commit non-overwriting.
 *
 * Never log `uploadUrl` — its query string is a credential.
 */
export async function uploadFileToBlob(
  uploadUrl: string,
  file: Blob,
  contentType: string,
  onProgress: (loadedBytes: number) => void,
  signal: AbortSignal,
): Promise<void> {
  const client = new BlockBlobClient(uploadUrl);
  await client.uploadData(file, {
    blockSize: 8 * MiB,
    maxSingleShotSize: 8 * MiB,
    concurrency: 4,
    blobHTTPHeaders: { blobContentType: contentType },
    conditions: { ifNoneMatch: "*" },
    onProgress: (ev) => onProgress(ev.loadedBytes),
    abortSignal: signal,
  });
}

/** Safe summary of an Azure SDK / fetch error — no URLs, no messages that may embed them. */
export function describeBlobError(err: unknown): { status?: number; code: string } {
  if (err && typeof err === "object") {
    const e = err as { statusCode?: number; code?: string; name?: string };
    if (e.name === "AbortError") return { code: "aborted" };
    return { status: e.statusCode, code: e.code ?? e.name ?? "upload_failed" };
  }
  return { code: "upload_failed" };
}
