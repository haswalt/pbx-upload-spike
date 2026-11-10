import type {
  ApiError,
  CompleteUploadResponse,
  CreateUploadRequest,
  CreateUploadResponse,
} from "@/lib/contracts";

export class ApiCallError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
    cache: "no-store",
  });
  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const err = body as Partial<ApiError> | null;
    throw new ApiCallError(res.status, err?.error ?? "http_error", err?.message ?? `HTTP ${res.status}`);
  }
  return body as T;
}

export const api = {
  createUpload: (req: CreateUploadRequest, init?: RequestInit) =>
    call<CreateUploadResponse>("/api/uploads", { method: "POST", body: JSON.stringify(req), ...init }),
  complete: (uploadId: string) =>
    call<CompleteUploadResponse>(`/api/uploads/${encodeURIComponent(uploadId)}/complete`, {
      method: "POST",
      body: "{}",
    }),
  remove: (uploadId: string) =>
    call<{ deleted: boolean }>(`/api/uploads/${encodeURIComponent(uploadId)}`, { method: "DELETE" }),
};
