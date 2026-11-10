"use client";

import { useCallback, useRef, useState } from "react";
import {
  MiB,
  UPLOAD_POLICIES,
  checkHints,
  formatBytes,
  inferContentType,
  type UploadType,
} from "@/lib/contracts";
import { ApiCallError, api } from "@/lib/client/api";
import { describeBlobError, uploadFileToBlob } from "@/lib/client/blob-upload";
import styles from "./spike.module.css";

type Status =
  | "rejected"
  | "queued"
  | "requesting"
  | "uploading"
  | "verifying"
  | "uploaded"
  | "accepted"
  | "failed"
  | "cancelled"
  | "deleted";

interface Item {
  key: string;
  file: File;
  contentType: string;
  uploadType: UploadType;
  status: Status;
  loaded: number;
  attempts: number;
  error?: string;
  uploadId?: string;
  blobKey?: string;
  verifiedSize?: number;
  issueMs?: number;
  uploadMs?: number;
  completeMs?: number;
}

const MAX_PARALLEL_FILES = 3;
const ACCEPT = [UPLOAD_POLICIES.photo.accept, UPLOAD_POLICIES.video.accept].join(",");

function createLimiter(limit: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    if (active >= limit) return;
    const start = queue.shift();
    if (start) {
      active++;
      start();
    }
  };
  return <T,>(task: () => Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      queue.push(() => {
        task()
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      });
      next();
    });
}

export function Uploader() {
  const [items, setItems] = useState<Item[]>([]);
  const [verify, setVerify] = useState(true);
  const controllers = useRef(new Map<string, AbortController>());
  const limiter = useRef(createLimiter(MAX_PARALLEL_FILES));

  const patch = useCallback((key: string, changes: Partial<Item>) => {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...changes } : it)));
  }, []);

  const run = useCallback(
    (item: Item, verifyEnabled: boolean) => {
      // Controller exists from enqueue time so queued items can be cancelled.
      const controller = new AbortController();
      controllers.current.set(item.key, controller);
      return limiter.current(async () => {
        try {
          // One automatic retry with a fresh SAS if Azure rejects the
          // signature (e.g. it expired while queued).
          for (let attempt = 1; attempt <= 2; attempt++) {
            if (controller.signal.aborted) throw new Error("aborted");
            patch(item.key, { status: "requesting", loaded: 0, attempts: item.attempts + attempt, error: undefined });

            const t0 = performance.now();
            const issued = await api.createUpload(
              {
                uploadType: item.uploadType,
                filename: item.file.name,
                size: item.file.size,
                contentType: item.contentType,
              },
              { signal: controller.signal },
            );
            const t1 = performance.now();
            patch(item.key, {
              status: "uploading",
              uploadId: issued.uploadId,
              blobKey: issued.blobKey,
              issueMs: t1 - t0,
            });

            try {
              await uploadFileToBlob(
                issued.uploadUrl,
                item.file,
                item.contentType,
                (loaded) => patch(item.key, { loaded }),
                controller.signal,
              );
            } catch (err) {
              const { status, code } = describeBlobError(err);
              if (status === 403 && attempt === 1 && !controller.signal.aborted) continue;
              throw new Error(code === "aborted" ? "aborted" : `Blob Storage rejected the upload (${status ?? "network"} ${code})`);
            }
            const t2 = performance.now();
            patch(item.key, { uploadMs: t2 - t1, loaded: item.file.size });

            if (!verifyEnabled) {
              patch(item.key, { status: "uploaded" });
              return;
            }
            patch(item.key, { status: "verifying" });
            const done = await api.complete(issued.uploadId);
            patch(item.key, {
              status: "accepted",
              verifiedSize: done.size,
              completeMs: performance.now() - t2,
            });
            return;
          }
        } catch (err) {
          if (controller.signal.aborted || (err instanceof Error && err.message === "aborted")) {
            patch(item.key, { status: "cancelled" });
          } else {
            patch(item.key, {
              status: "failed",
              error: err instanceof ApiCallError ? `${err.status} ${err.code}: ${err.message}` : err instanceof Error ? err.message : "Upload failed",
            });
          }
        } finally {
          controllers.current.delete(item.key);
        }
      });
    },
    [patch],
  );

  const onFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const added: Item[] = Array.from(files).map((file) => {
      const contentType = inferContentType(file.name, file.type);
      const uploadType: UploadType = contentType.startsWith("video/") ? "video" : "photo";
      const problem = checkHints(uploadType, file.size, contentType);
      return {
        key: crypto.randomUUID(),
        file,
        contentType,
        uploadType,
        status: problem ? "rejected" : "queued",
        loaded: 0,
        attempts: 0,
        error: problem?.message,
      };
    });
    setItems((prev) => [...added, ...prev]);
    for (const item of added) if (item.status === "queued") void run(item, verify);
  };

  const cancel = (key: string) => controllers.current.get(key)?.abort();

  const retry = (item: Item) => {
    const fresh = { ...item, status: "queued" as const, loaded: 0, error: undefined };
    patch(item.key, fresh);
    void run(fresh, verify);
  };

  const remove = async (item: Item) => {
    if (!item.uploadId) return;
    try {
      const res = await api.remove(item.uploadId);
      patch(item.key, { status: "deleted", error: res.deleted ? undefined : "Blob was already gone" });
    } catch (err) {
      patch(item.key, { error: err instanceof Error ? err.message : "Delete failed" });
    }
  };

  return (
    <section className={styles.card}>
      <h2>Upload photos &amp; videos</h2>
      <p className={styles.muted}>
        Photos up to {formatBytes(UPLOAD_POLICIES.photo.maxBytes)} (JPEG, PNG, WebP, HEIC). Videos up to{" "}
        {formatBytes(UPLOAD_POLICIES.video.maxBytes)} (MP4, MOV, WebM). Files go straight to Blob Storage; up to{" "}
        {MAX_PARALLEL_FILES} at a time.
      </p>
      <div className={styles.row}>
        <label className={styles.fileButton}>
          Choose files
          <input
            type="file"
            multiple
            accept={ACCEPT}
            onChange={(e) => {
              onFiles(e.currentTarget.files);
              e.currentTarget.value = "";
            }}
          />
        </label>
        <label className={styles.checkbox}>
          <input type="checkbox" checked={verify} onChange={(e) => setVerify(e.currentTarget.checked)} />
          Verify with <code>complete</code> endpoint
        </label>
        {items.length > 0 && (
          <button className={styles.linkButton} onClick={() => setItems((prev) => prev.filter((i) => controllers.current.has(i.key)))}>
            Clear finished
          </button>
        )}
      </div>

      {items.length > 0 && (
        <ul className={styles.list}>
          {items.map((item) => (
            <UploadRow key={item.key} item={item} onCancel={cancel} onRetry={retry} onDelete={remove} />
          ))}
        </ul>
      )}
    </section>
  );
}

const STATUS_LABEL: Record<Status, string> = {
  rejected: "Rejected locally",
  queued: "Queued",
  requesting: "Requesting upload URL…",
  uploading: "Uploading",
  verifying: "Verifying…",
  uploaded: "Uploaded (not verified)",
  accepted: "Accepted",
  failed: "Failed",
  cancelled: "Cancelled",
  deleted: "Deleted",
};

function UploadRow({
  item,
  onCancel,
  onRetry,
  onDelete,
}: {
  item: Item;
  onCancel: (key: string) => void;
  onRetry: (item: Item) => void;
  onDelete: (item: Item) => void;
}) {
  const pct = item.file.size ? Math.round((item.loaded / item.file.size) * 100) : 0;
  const busy = ["queued", "requesting", "uploading", "verifying"].includes(item.status);
  const tone =
    item.status === "accepted" || item.status === "uploaded"
      ? styles.ok
      : item.status === "failed" || item.status === "rejected"
        ? styles.bad
        : "";
  const mbps = item.uploadMs ? item.file.size / MiB / (item.uploadMs / 1000) : undefined;

  return (
    <li className={styles.item}>
      <div className={styles.itemHead}>
        <strong className={styles.filename} title={item.file.name}>
          {item.file.name}
        </strong>
        <span className={styles.muted}>
          {UPLOAD_POLICIES[item.uploadType].label} · {item.contentType} · {formatBytes(item.file.size)}
        </span>
        <span className={`${styles.status} ${tone}`}>
          {STATUS_LABEL[item.status]}
          {item.status === "uploading" ? ` ${pct}%` : ""}
          {item.attempts > 1 ? ` (attempt ${item.attempts})` : ""}
        </span>
      </div>

      {(item.status === "uploading" || item.status === "verifying") && (
        <progress className={styles.progress} max={item.file.size} value={item.loaded} />
      )}

      {item.error && <p className={styles.error}>{item.error}</p>}

      {item.blobKey && (
        <dl className={styles.meta}>
          <dt>Blob key</dt>
          <dd>
            <code>{item.blobKey}</code>
          </dd>
          {item.issueMs !== undefined && (
            <>
              <dt>Timing</dt>
              <dd>
                issue {ms(item.issueMs)}
                {item.uploadMs !== undefined && ` · upload ${ms(item.uploadMs)}`}
                {mbps !== undefined && ` (${mbps.toFixed(1)} MiB/s)`}
                {item.completeMs !== undefined && ` · complete ${ms(item.completeMs)}`}
              </dd>
            </>
          )}
          {item.verifiedSize !== undefined && (
            <>
              <dt>Verified size</dt>
              <dd>{item.verifiedSize.toLocaleString()} bytes</dd>
            </>
          )}
        </dl>
      )}

      <div className={styles.actions}>
        {busy && <button onClick={() => onCancel(item.key)}>Cancel</button>}
        {(item.status === "failed" || item.status === "cancelled") && (
          <button onClick={() => onRetry(item)}>Retry with fresh URL</button>
        )}
        {item.uploadId && (item.status === "accepted" || item.status === "uploaded") && (
          <button onClick={() => onDelete(item)}>Delete blob</button>
        )}
      </div>
    </li>
  );
}

const ms = (n: number) => (n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(2)} s`);
