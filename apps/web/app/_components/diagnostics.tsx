"use client";

import { useState } from "react";
import { MiB, type CreateUploadRequest, type CreateUploadResponse } from "@/lib/contracts";
import { ApiCallError, api } from "@/lib/client/api";
import styles from "./spike.module.css";

/**
 * Executable version of the spike test matrix. Results show status codes
 * only — SAS URLs are never rendered or logged.
 */

interface Result {
  pass: boolean;
  detail: string;
}

interface Check {
  id: string;
  title: string;
  expected: string;
  debugOnly?: boolean;
  run: () => Promise<Result>;
}

const tinyPhoto = (bytes = 1024): CreateUploadRequest => ({
  uploadType: "photo",
  filename: "diag.jpg",
  size: bytes,
  contentType: "image/jpeg",
});

const bytes = (n: number) => new Uint8Array(n).fill(0xff);

/** Raw PUT Blob. Returns HTTP status, or 0 if the browser blocked it (CORS/network). */
async function rawPut(url: string, body: BodyInit, extra: Record<string, string> = {}): Promise<number> {
  try {
    const res = await fetch(url, {
      method: "PUT",
      headers: { "x-ms-blob-type": "BlockBlob", "x-ms-blob-content-type": "image/jpeg", ...extra },
      body,
    });
    return res.status;
  } catch {
    return 0;
  }
}

async function rawGet(url: string): Promise<number> {
  try {
    return (await fetch(url, { method: "GET" })).status;
  } catch {
    return 0;
  }
}

const withoutSas = (url: string) => url.split("?")[0]!;

async function expectApiError(fn: () => Promise<unknown>, status: number): Promise<Result> {
  try {
    await fn();
    return { pass: false, detail: "Request unexpectedly succeeded" };
  } catch (err) {
    if (err instanceof ApiCallError) {
      return { pass: err.status === status, detail: `${err.status} ${err.code}` };
    }
    return { pass: false, detail: String(err) };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function cleanup(upload: CreateUploadResponse) {
  await api.remove(upload.uploadId).catch(() => undefined);
}

const CHECKS: Check[] = [
  {
    id: "happy",
    title: "Valid small upload → complete → delete",
    expected: "PUT 201, complete 200 accepted, delete removes blob",
    run: async () => {
      const up = await api.createUpload(tinyPhoto());
      const put = await rawPut(up.uploadUrl, bytes(1024));
      if (put !== 201) return { pass: false, detail: `PUT ${put}` };
      const done = await api.complete(up.uploadId);
      const del = await api.remove(up.uploadId);
      return {
        pass: done.status === "accepted" && done.size === 1024 && del.deleted,
        detail: `PUT ${put} · complete ${done.status} (${done.size} B) · deleted=${del.deleted}`,
      };
    },
  },
  {
    id: "unauth",
    title: "Unauthenticated SAS issuance",
    expected: "API 401",
    run: async () => {
      const res = await fetch("/api/uploads", {
        method: "POST",
        credentials: "omit",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(tinyPhoto()),
      });
      return { pass: res.status === 401, detail: `${res.status}` };
    },
  },
  {
    id: "bad-type",
    title: "Unknown uploadType",
    expected: "API 400",
    run: () =>
      expectApiError(() => api.createUpload({ ...tinyPhoto(), uploadType: "document" as never }), 400),
  },
  {
    id: "bad-mime",
    title: "MIME hint not allowed for type (photo + video/mp4)",
    expected: "API 422",
    run: () => expectApiError(() => api.createUpload({ ...tinyPhoto(), contentType: "video/mp4" }), 422),
  },
  {
    id: "too-big-hint",
    title: "Oversized size hint (26 MiB photo)",
    expected: "API 422",
    run: () => expectApiError(() => api.createUpload(tinyPhoto(26 * MiB)), 422),
  },
  {
    id: "altered-path",
    title: "Altered blob path with valid SAS",
    expected: "Azure 403 (signature doesn't cover the new path)",
    run: async () => {
      const up = await api.createUpload(tinyPhoto());
      const url = new URL(up.uploadUrl);
      url.pathname = url.pathname.replace(/[^/]+$/, `tampered-${crypto.randomUUID()}.jpg`);
      const status = await rawPut(url.toString(), bytes(16));
      return { pass: status === 403, detail: `PUT ${status}` };
    },
  },
  {
    id: "no-sas",
    title: "Blob URL without SAS (anonymous write + read)",
    expected: "Not 2xx for PUT or GET",
    run: async () => {
      const up = await api.createUpload(tinyPhoto());
      const okPut = await rawPut(up.uploadUrl, bytes(64));
      const anonPut = await rawPut(withoutSas(up.uploadUrl), bytes(64));
      const anonGet = await rawGet(withoutSas(up.uploadUrl));
      await cleanup(up);
      const denied = (s: number) => s === 0 || s >= 400;
      return {
        pass: okPut === 201 && denied(anonPut) && denied(anonGet),
        detail: `with SAS ${okPut} · anon PUT ${anonPut || "blocked"} · anon GET ${anonGet || "blocked by CORS (verify with curl)"}`,
      };
    },
  },
  {
    id: "overwrite",
    title: "Second PUT to same blob (If-None-Match: *)",
    expected: "Azure 409 BlobAlreadyExists",
    run: async () => {
      const up = await api.createUpload(tinyPhoto());
      const first = await rawPut(up.uploadUrl, bytes(32), { "If-None-Match": "*" });
      const second = await rawPut(up.uploadUrl, bytes(32), { "If-None-Match": "*" });
      await cleanup(up);
      return { pass: first === 201 && second === 409, detail: `first ${first} · second ${second}` };
    },
  },
  {
    id: "missing",
    title: "Complete before any bytes uploaded",
    expected: "API 404 blob_missing",
    run: async () => {
      const up = await api.createUpload(tinyPhoto());
      return expectApiError(() => api.complete(up.uploadId), 404);
    },
  },
  {
    id: "repeat",
    title: "Repeated issuance for the same file",
    expected: "Distinct server-generated blob keys",
    run: async () => {
      const [a, b] = await Promise.all([api.createUpload(tinyPhoto()), api.createUpload(tinyPhoto())]);
      return { pass: a.blobKey !== b.blobKey, detail: `${a.blobKey} ≠ ${b.blobKey}` };
    },
  },
  {
    id: "expired",
    title: "Expired SAS (1s TTL, wait 5s)",
    expected: "Azure 403",
    debugOnly: true,
    run: async () => {
      const up = await api.createUpload({ ...tinyPhoto(), debug: { ttlSeconds: 1 } });
      await sleep(5000);
      const status = await rawPut(up.uploadUrl, bytes(16));
      if (status === 201) await cleanup(up);
      return { pass: status === 403, detail: `PUT ${status} (expiresAt ${up.expiresAt})` };
    },
  },
  {
    id: "bypass-size",
    title: "Bypassed client size check (hint 512 B, limit 1 KiB, sends 4 KiB)",
    expected: "PUT 201, complete 422 blob_too_large, blob deleted",
    debugOnly: true,
    run: async () => {
      const up = await api.createUpload({ ...tinyPhoto(512), debug: { maxBytes: 1024 } });
      const put = await rawPut(up.uploadUrl, bytes(4096));
      const result = await expectApiError(() => api.complete(up.uploadId), 422);
      return { pass: put === 201 && result.pass, detail: `PUT ${put} · complete ${result.detail}` };
    },
  },
];

export function Diagnostics({ debugTools }: { debugTools: boolean }) {
  const [results, setResults] = useState<Record<string, Result | "running">>({});
  const [running, setRunning] = useState(false);

  const runOne = async (check: Check) => {
    setResults((r) => ({ ...r, [check.id]: "running" }));
    let result: Result;
    try {
      result = await check.run();
    } catch (err) {
      result = {
        pass: false,
        detail: err instanceof ApiCallError ? `${err.status} ${err.code}: ${err.message}` : String(err),
      };
    }
    setResults((r) => ({ ...r, [check.id]: result }));
  };

  const runAll = async () => {
    setRunning(true);
    await Promise.all(CHECKS.filter((c) => debugTools || !c.debugOnly).map(runOne));
    setRunning(false);
  };

  return (
    <section className={styles.card}>
      <div className={styles.row}>
        <h2>Diagnostics</h2>
        <button onClick={runAll} disabled={running}>
          {running ? "Running…" : "Run all"}
        </button>
      </div>
      <p className={styles.muted}>
        Executes the spike test matrix from this browser. Creates and cleans up tiny test blobs.
        {!debugTools && " Expired-SAS and size-bypass checks need SPIKE_DEBUG_TOOLS=true."}
      </p>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Scenario</th>
            <th>Expected</th>
            <th>Result</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {CHECKS.map((check) => {
            const r = results[check.id];
            const disabled = check.debugOnly && !debugTools;
            return (
              <tr key={check.id} className={disabled ? styles.disabled : ""}>
                <td>{check.title}</td>
                <td className={styles.muted}>{check.expected}</td>
                <td>
                  {r === "running" ? (
                    "…"
                  ) : r ? (
                    <span className={r.pass ? styles.ok : styles.bad}>
                      {r.pass ? "PASS" : "FAIL"} <span className={styles.muted}>{r.detail}</span>
                    </span>
                  ) : disabled ? (
                    "needs debug tools"
                  ) : (
                    ""
                  )}
                </td>
                <td>
                  <button onClick={() => runOne(check)} disabled={disabled || r === "running"}>
                    Run
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
