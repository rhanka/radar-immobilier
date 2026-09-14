import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

import { createLlmMeshFacade } from
  "/workspace/node_modules/@sentropic/llm-mesh/dist/service/facade.js";
import { EncryptedFileKeyring } from
  "/workspace/node_modules/@sentropic/llm-mesh/dist/node/index.js";

const ownerScope = process.env.BENCHMARK_OWNER_SCOPE;
const outputPath = process.env.BENCHMARK_AVAILABILITY_OUTPUT;
if (!ownerScope || !outputPath) throw new Error("Missing availability configuration");
const facade = createLlmMeshFacade({ mode: "cli",
  configResolver: { async resolveConfig() { return {}; } },
  keyring: new EncryptedFileKeyring("/run/benchmark-keyring") });
const accounts = await facade.listAccounts({ ownerScope });
const pseudonym = (id) => `acct-${createHash("sha256").update(id).digest("hex").slice(0, 10)}`;
const providers = [...new Set(accounts.map(({ providerId }) => providerId))].sort();
const anthropic = accounts.filter(({ providerId }) => providerId === "anthropic");
const receipt = { schemaVersion: 1, capturedAt: new Date().toISOString(),
  providers, anthropic: { count: anthropic.length,
    accountPseudonyms: anthropic.map(({ accountId }) => pseudonym(accountId)) },
  secretsIncluded: false };
await writeFile(outputPath, JSON.stringify(receipt), { flag: "wx" });
console.log(JSON.stringify(receipt));
