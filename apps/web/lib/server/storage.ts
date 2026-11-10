import "server-only";
import {
  DefaultAzureCredential,
  type TokenCredential,
} from "@azure/identity";
import {
  BlobSASPermissions,
  BlobServiceClient,
  SASProtocol,
  generateBlobSASQueryParameters,
  type UserDelegationKey,
} from "@azure/storage-blob";
import { storageConfig } from "./env";

/**
 * All storage access uses Entra ID (DefaultAzureCredential). No account keys.
 *  - Local: `az login` (AzureCliCredential)
 *  - Vercel: service principal via AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET
 *  - Azure-hosted: managed identity
 */

let credential: TokenCredential | undefined;
let serviceClient: BlobServiceClient | undefined;

function client(): BlobServiceClient {
  if (!serviceClient) {
    credential ??= new DefaultAzureCredential();
    serviceClient = new BlobServiceClient(storageConfig().blobEndpoint, credential);
  }
  return serviceClient;
}

// ---------------------------------------------------------------------------
// User delegation key cache. Keys are valid for up to 7 days; fetching one per
// request would add an Entra + Storage round trip to every issuance.
// ---------------------------------------------------------------------------

const KEY_LIFETIME_MS = 6 * 60 * 60 * 1000;
let cachedKey: { key: UserDelegationKey; expiresOn: Date } | undefined;
let inflight: Promise<UserDelegationKey> | undefined;

async function delegationKey(minValidUntil: Date): Promise<UserDelegationKey> {
  if (cachedKey && cachedKey.expiresOn > minValidUntil) return cachedKey.key;
  inflight ??= (async () => {
    try {
      const startsOn = new Date(Date.now() - 5 * 60 * 1000); // clock skew
      const expiresOn = new Date(Date.now() + KEY_LIFETIME_MS);
      const key = await client().getUserDelegationKey(startsOn, expiresOn);
      cachedKey = { key, expiresOn };
      return key;
    } finally {
      inflight = undefined;
    }
  })();
  return inflight;
}

export interface IssuedSas {
  uploadUrl: string;
  expiresOn: Date;
}

/**
 * User delegation SAS for exactly one blob.
 * Permissions: create + write (Put Blob, Put Block, Put Block List).
 * No read, list, delete, or tag permissions. HTTPS only.
 */
export async function issueBlobSas(
  containerName: string,
  blobName: string,
  ttlSeconds: number,
): Promise<IssuedSas> {
  const { accountName } = storageConfig();
  const startsOn = new Date(Date.now() - 5 * 60 * 1000);
  const expiresOn = new Date(Date.now() + ttlSeconds * 1000);
  const key = await delegationKey(expiresOn);

  const sas = generateBlobSASQueryParameters(
    {
      containerName,
      blobName,
      permissions: BlobSASPermissions.parse("cw"),
      startsOn,
      expiresOn,
      protocol: SASProtocol.Https,
    },
    key,
    accountName,
  ).toString();

  const blobUrl = client()
    .getContainerClient(containerName)
    .getBlockBlobClient(blobName).url;
  return { uploadUrl: `${blobUrl}?${sas}`, expiresOn };
}

/** HEAD the blob. Never downloads content. Returns null if it doesn't exist. */
export async function blobProperties(containerName: string, blobName: string) {
  const blob = client().getContainerClient(containerName).getBlobClient(blobName);
  try {
    const props = await blob.getProperties();
    return {
      size: props.contentLength ?? 0,
      contentType: props.contentType ?? null,
      lastModified: props.lastModified ?? null,
    };
  } catch (err) {
    if (statusOf(err) === 404) return null;
    throw err;
  }
}

export async function deleteBlob(containerName: string, blobName: string) {
  const res = await client()
    .getContainerClient(containerName)
    .getBlobClient(blobName)
    .deleteIfExists({ deleteSnapshots: "include" });
  return res.succeeded;
}

/** Cheap credential/permission probe for /api/health?deep=1. */
export async function probeDelegation(): Promise<void> {
  await delegationKey(new Date(Date.now() + 60_000));
}

export function statusOf(err: unknown): number | undefined {
  return typeof err === "object" && err && "statusCode" in err
    ? (err as { statusCode?: number }).statusCode
    : undefined;
}
