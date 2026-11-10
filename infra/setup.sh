#!/usr/bin/env bash
# Provision the Azure side of the upload spike with the Azure CLI.
# Idempotent-ish: safe to re-run; existing resources are updated in place.
#
# Usage:
#   az login
#   az account set --subscription <id>
#   ORIGINS="http://localhost:3000,https://pbx-upload-spike.vercel.app" ./infra/setup.sh
#
# Everything uses the management plane (ARM) or Entra, so it works with
# Shared Key access disabled on the account.
set -euo pipefail

RG="${RG:-rg-pbx-upload-spike}"
LOCATION="${LOCATION:-uksouth}"
ACCOUNT="${ACCOUNT:-pbxuploadspike$RANDOM}"   # 3-24 lowercase alphanumerics, globally unique
CONTAINER="${CONTAINER:-incoming}"
ORIGINS="${ORIGINS:-http://localhost:3000}"   # comma-separated, exact origins
SP_NAME="${SP_NAME:-sp-pbx-upload-spike}"
GRANT_CURRENT_USER="${GRANT_CURRENT_USER:-true}" # so `az login` works for local dev
INCOMING_RETENTION_DAYS="${INCOMING_RETENTION_DAYS:-7}"

echo "==> Resource group $RG ($LOCATION)"
az group create -n "$RG" -l "$LOCATION" -o none

echo "==> Storage account $ACCOUNT"
az storage account create \
  -n "$ACCOUNT" -g "$RG" -l "$LOCATION" \
  --kind StorageV2 --sku Standard_LRS --access-tier Hot \
  --https-only true --min-tls-version TLS1_2 \
  --allow-blob-public-access false \
  --allow-shared-key-access false \
  --public-network-access Enabled \
  -o none
ACCOUNT_ID=$(az storage account show -n "$ACCOUNT" -g "$RG" --query id -o tsv)

echo "==> Private container $CONTAINER"
az storage container-rm create --storage-account "$ACCOUNT" -g "$RG" -n "$CONTAINER" --public-access off -o none

echo "==> Blob CORS for: $ORIGINS"
ORIGINS_JSON=$(printf '%s' "$ORIGINS" | python3 -c 'import json,sys; print(json.dumps([o.strip() for o in sys.stdin.read().split(",") if o.strip()]))')
az rest --method put \
  --url "https://management.azure.com${ACCOUNT_ID}/blobServices/default?api-version=2023-05-01" \
  --body "{
    \"properties\": {
      \"cors\": { \"corsRules\": [{
        \"allowedOrigins\": $ORIGINS_JSON,
        \"allowedMethods\": [\"PUT\", \"OPTIONS\"],
        \"allowedHeaders\": [\"content-type\", \"content-length\", \"if-none-match\", \"x-ms-*\"],
        \"exposedHeaders\": [\"etag\", \"x-ms-request-id\", \"x-ms-error-code\"],
        \"maxAgeInSeconds\": 3600
      }]}
    }
  }" -o none

echo "==> Lifecycle: delete abandoned $CONTAINER/ blobs after $INCOMING_RETENTION_DAYS days"
POLICY_FILE=$(mktemp)
cat > "$POLICY_FILE" <<JSON
{
  "rules": [
    {
      "enabled": true,
      "name": "expire-incoming",
      "type": "Lifecycle",
      "definition": {
        "filters": { "blobTypes": ["blockBlob"], "prefixMatch": ["$CONTAINER/"] },
        "actions": { "baseBlob": { "delete": { "daysAfterModificationGreaterThan": $INCOMING_RETENTION_DAYS } } }
      }
    }
  ]
}
JSON
az storage account management-policy create --account-name "$ACCOUNT" -g "$RG" --policy "@$POLICY_FILE" -o none
rm -f "$POLICY_FILE"

CONTAINER_SCOPE="$ACCOUNT_ID/blobServices/default/containers/$CONTAINER"

assign() { # principalId principalType
  az role assignment create --assignee-object-id "$1" --assignee-principal-type "$2" \
    --role "Storage Blob Delegator" --scope "$ACCOUNT_ID" -o none
  az role assignment create --assignee-object-id "$1" --assignee-principal-type "$2" \
    --role "Storage Blob Data Contributor" --scope "$CONTAINER_SCOPE" -o none
}

echo "==> Service principal $SP_NAME (server identity for Vercel)"
SP_JSON=$(az ad sp create-for-rbac --name "$SP_NAME" -o json)
APP_ID=$(echo "$SP_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["appId"])')
SP_OBJECT_ID=$(az ad sp show --id "$APP_ID" --query id -o tsv)
assign "$SP_OBJECT_ID" ServicePrincipal

if [[ "$GRANT_CURRENT_USER" == "true" ]]; then
  echo "==> Granting the signed-in user the same roles (local dev via az login)"
  assign "$(az ad signed-in-user show --query id -o tsv)" User
fi

cat <<OUT

Done. Role assignments can take a few minutes to propagate.

Set these in apps/web/.env.local and in Vercel (Production + Preview):

  AZURE_STORAGE_ACCOUNT_NAME=$ACCOUNT
  AZURE_STORAGE_CONTAINER=$CONTAINER
  AZURE_TENANT_ID=$(echo "$SP_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["tenant"])')
  AZURE_CLIENT_ID=$APP_ID
  AZURE_CLIENT_SECRET=<printed once below — store it in Vercel, not in git>

OUT
echo "$SP_JSON" | python3 -c 'import json,sys; print("  client secret:", json.load(sys.stdin)["password"])'
echo
echo "Tear down when finished:  az group delete -n $RG --yes && az ad sp delete --id $APP_ID"
