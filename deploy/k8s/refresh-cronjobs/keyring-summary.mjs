/* global console */

import { listModelProfiles } from "@sentropic/llm-mesh-refresh";
import { EncryptedFileKeyring } from "@sentropic/llm-mesh-refresh/node";

const keyring = new EncryptedFileKeyring("/keyring");
const indexRaw = await keyring.getSecret("sentropic-llm-mesh:accounts:index");
const accountIds = indexRaw ? JSON.parse(indexRaw) : [];
const accounts = [];
for (const accountId of accountIds) {
  const raw = await keyring.getSecret(`sentropic-llm-mesh:${accountId}:public`);
  if (!raw) continue;
  const record = JSON.parse(raw);
  const account = record.account ?? {};
  accounts.push({
    provider: account.targetProviderId,
    transport: account.transportProviderId,
    ownerScopeRef: account.ownerScopeRef,
    status: account.status ?? record.status,
    explicitModels: account.modelIds ?? [],
  });
}
const candidates = listModelProfiles()
  .filter(({ label, modelId }) => /Sonnet 4\.6|Gemini 3\.8|GPT-5\.6 Luna/i.test(`${label} ${modelId}`))
  .map(({ providerId, modelId, label }) => ({ providerId, modelId, label }));
console.log(JSON.stringify({ accounts, candidates }, null, 2));
