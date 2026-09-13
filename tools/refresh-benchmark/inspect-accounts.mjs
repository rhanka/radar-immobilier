import { createHash } from "node:crypto";
import { EncryptedFileKeyring } from "/workspace/node_modules/@sentropic/llm-mesh-refresh/dist/node/index.js";

const keyring = new EncryptedFileKeyring("/run/benchmark-keyring");
const indexKey = "sentropic-llm-mesh:accounts:index";
const rawIndex = await keyring.getSecret(indexKey);
const accountIds = rawIndex ? JSON.parse(rawIndex) : [];

const pseudonym = (value) =>
  `acct-${createHash("sha256").update(value).digest("hex").slice(0, 10)}`;

const accounts = [];
for (const accountId of accountIds) {
  const raw = await keyring.getSecret(`sentropic-llm-mesh:${accountId}:public`);
  if (!raw) continue;
  const record = JSON.parse(raw);
  accounts.push({
    pseudonym: pseudonym(accountId),
    ownerScopeRef: record.account?.ownerScopeRef ?? null,
    targetProviderId: record.account?.targetProviderId ?? null,
    transportProviderId: record.account?.transportProviderId ?? null,
    modelIds: record.account?.modelIds ?? null,
    status: record.status ?? record.account?.status ?? null,
    expiresAt: record.account?.expiresAt ?? null,
    enrollmentCompletedAt: record.account?.enrollmentCompletedAt ?? null,
  });
}

console.log(JSON.stringify({ accounts }, null, 2));
