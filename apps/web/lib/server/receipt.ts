import "server-only";
import type { UploadType } from "@/lib/contracts";
import { sign, verify } from "./signing";

/**
 * Stateless upload receipt. The `uploadId` handed to the browser IS this
 * signed token, so `complete`/`delete` can resolve it to the server-issued
 * blob name without a database (works across serverless instances).
 * Holding the receipt is what authorises complete/delete for that one blob.
 */
export interface UploadReceipt {
  v: 1;
  /** Random id, also the blob's file stem. */
  id: string;
  type: UploadType;
  container: string;
  blob: string;
  /** Max accepted bytes captured at issuance (policy or debug override). */
  maxBytes: number;
  iat: number;
  exp: number;
}

const RECEIPT_TTL_SECONDS = 24 * 60 * 60;

export function issueReceipt(
  fields: Omit<UploadReceipt, "v" | "iat" | "exp">,
): string {
  const iat = Math.floor(Date.now() / 1000);
  const receipt: UploadReceipt = {
    v: 1,
    ...fields,
    iat,
    exp: iat + RECEIPT_TTL_SECONDS,
  };
  return sign("receipt", receipt);
}

export function readReceipt(token: string): UploadReceipt | null {
  return verify<UploadReceipt>("receipt", token);
}
