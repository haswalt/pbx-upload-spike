import "server-only";

/**
 * Server-side configuration. Read lazily so `next build` works without
 * secrets present; missing values fail at request time with a clear error.
 *
 * Azure credentials are NOT read here — `DefaultAzureCredential` picks up
 * AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET (service principal,
 * e.g. on Vercel) or falls back to the Azure CLI login locally.
 */

export class ConfigError extends Error {}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new ConfigError(`Missing required env var ${name}`);
  return value;
}

export function storageConfig() {
  const accountName = required("AZURE_STORAGE_ACCOUNT_NAME");
  return {
    accountName,
    containerName: process.env.AZURE_STORAGE_CONTAINER?.trim() || "incoming",
    blobEndpoint:
      process.env.AZURE_STORAGE_BLOB_ENDPOINT?.trim().replace(/\/$/, "") ||
      `https://${accountName}.blob.core.windows.net`,
  };
}

/** HMAC key for upload receipts. RECEIPT_SECRET, falling back to the old SESSION_SECRET name. */
export function receiptSecret(): string {
  const secret = process.env.RECEIPT_SECRET?.trim() || process.env.SESSION_SECRET?.trim();
  if (!secret) throw new ConfigError("Missing required env var RECEIPT_SECRET");
  if (secret.length < 32) {
    throw new ConfigError("RECEIPT_SECRET must be at least 32 characters");
  }
  return secret;
}

/** Enables the debug TTL/size overrides used by the diagnostics panel. */
export function debugToolsEnabled(): boolean {
  return process.env.SPIKE_DEBUG_TOOLS === "true";
}

export function issuanceRateLimit(): number {
  const n = Number(process.env.SPIKE_ISSUE_RATE_PER_MINUTE ?? "60");
  return Number.isFinite(n) && n > 0 ? n : 60;
}
