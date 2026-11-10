# Azure setup

`setup.sh` provisions everything the spike needs with the Azure CLI. It only
uses the management plane and Entra ID, so it works with Shared Key access
disabled.

```bash
az login
az account set --subscription <subscription-id>
ORIGINS="http://localhost:3000,https://<your-app>.vercel.app" ./infra/setup.sh
```

Optional overrides: `RG`, `LOCATION` (default `uksouth`), `ACCOUNT`, `CONTAINER`
(default `incoming`), `SP_NAME`, `GRANT_CURRENT_USER`, `INCOMING_RETENTION_DAYS`.

## What it creates

| Resource | Setting | Why |
|---|---|---|
| Storage account | StorageV2, Standard LRS, Hot | Cheapest option for a test. Look at ZRS for production. |
| | Anonymous blob access **off** | No public reads. Delivery goes through a controlled layer later. |
| | Shared Key access **off** | Rules out account-key SAS. Only Entra and user delegation SAS work. |
| | HTTPS only, TLS 1.2 minimum | |
| | Public network access **on** | Browsers PUT directly to `*.blob.core.windows.net`. A SAS doesn't get past a firewall. |
| Container `incoming` | Private | Write-only via a per-blob SAS. |
| Blob CORS | Exact origins only; `PUT, OPTIONS`; `x-ms-*`, `content-type`, `if-none-match` | Browser control only. Not a security boundary. |
| Lifecycle rule | Delete `incoming/` blobs after N days | Clears out abandoned uploads. Runs asynchronously (about once a day). |
| Service principal | **Storage Blob Delegator** on the account | Lets it call `generateUserDelegationKey`. |
| | **Storage Blob Data Contributor** on the `incoming` container only | A user delegation SAS can only grant what the principal itself has. Also covers the HEAD and delete in `complete` and cleanup. |
| Your user (optional) | The same two roles | So local `az login` can mint SAS tokens. |

### What a SAS grants

Every SAS this spike issues is a **user delegation SAS** with:

- `sr=b`: scoped to one blob whose name the server generates (`photo/<uuid>.jpg`)
- `sp=cw`: create and write only. No read, list, delete or tags.
- `spr=https`: HTTPS only
- `se`: 10 minutes for photos, 60 minutes for videos. A block upload has to finish before the SAS expires.
- Signed by the server identity's delegation key, so no account key is involved

The URL shows the **account name, container and blob path**. That alone grants
nothing. The **query string is the credential**, so the app never logs it or
shows it in the UI.

## Vercel

1. Import the repo into Vercel and set **Root Directory** to `apps/web`. Vercel detects the framework (Next.js) and pnpm automatically.
2. Add the environment variables from `apps/web/.env.example` for Production and Preview. Generate a new `RECEIPT_SECRET` (`openssl rand -base64 48`).
3. Add the deployed origin to Blob CORS by re-running `setup.sh` with `ORIGINS`, or in the portal under *Storage account → Resource sharing (CORS) → Blob service*. Azure allows at most 5 CORS rules, and each preview URL is a separate origin. For previews, use a stable branch alias instead of listing every URL.

### Getting rid of the client secret (recommended next step)

Vercel can issue OIDC tokens to functions. Set up a **federated credential** on
the app registration (issuer `https://oidc.vercel.com/<team-slug>`, subject
`owner:<team>:project:<project>:environment:production`). Then swap
`DefaultAzureCredential` for a `ClientAssertionCredential` that returns the
Vercel OIDC token. That removes `AZURE_CLIENT_SECRET` completely. It's left out
of this spike to keep setup to one script.

## Front Door, delivery and tiering (not provisioned)

These are design notes. Nothing here is created by the script.

- **Publishing:** copy accepted blobs from `incoming` to a private `published` container through a controlled service. Never let the browser write to `published`.
- **Front Door Premium + Private Link origin:** serve `published` through Front Door with a private endpoint to the storage account. Turning off public network access on *this* account would also block browser uploads. If the delivery origin has to be fully private, use a separate account for uploads.
- **Image CDNs:** check that the CDN can authenticate to a private origin (SAS, signed origin fetch). If it needs anonymous reads, that conflicts with a private origin.
- **Tiering:** use lifecycle rules (Hot → Cool after N days since last modification or access) on `published`, not on `incoming`. Keep anything that gets transformed on the fly in Hot. Cool and Cold add retrieval fees and minimum retention periods.

## Cost hygiene

Set a budget alert on the resource group. When the spike is over, run the
teardown command that `setup.sh` prints. It deletes the resource group and the
service principal.
