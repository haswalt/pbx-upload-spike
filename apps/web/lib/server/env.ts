import "server-only";
import type { Role } from "@/lib/contracts";

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

export function sessionSecret(): string {
  const secret = required("SESSION_SECRET");
  if (secret.length < 32) {
    throw new ConfigError("SESSION_SECRET must be at least 32 characters");
  }
  return secret;
}

export interface SpikeUser {
  id: string;
  password: string;
  role: Role;
}

/**
 * Documented test auth for the spike: SPIKE_USERS="alice:pw1:uploader,bob:pw2:viewer".
 * Replace with the real application identity mechanism before anything real.
 */
export function spikeUsers(): SpikeUser[] {
  const raw = process.env.SPIKE_USERS?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [id, password, role] = entry.split(":");
      if (!id || !password || (role !== "uploader" && role !== "viewer")) {
        throw new ConfigError(
          "SPIKE_USERS entries must look like id:password:uploader|viewer",
        );
      }
      return { id, password, role };
    });
}

/** Enables the diagnostics panel and the debug TTL/size overrides. */
export function debugToolsEnabled(): boolean {
  return process.env.SPIKE_DEBUG_TOOLS === "true";
}

export function issuanceRateLimit(): number {
  const n = Number(process.env.SPIKE_ISSUE_RATE_PER_MINUTE ?? "60");
  return Number.isFinite(n) && n > 0 ? n : 60;
}
