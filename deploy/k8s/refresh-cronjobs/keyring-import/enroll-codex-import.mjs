/* global console, process */

import { createHash } from "node:crypto";
import { EncryptedFileKeyring } from "@sentropic/llm-mesh-refresh/node";

const [runtimeDirectory, importDirectory] = process.argv.slice(2);
if (!runtimeDirectory || !importDirectory) throw new Error("runtime and import directories are required");
const indexKey = "sentropic-llm-mesh:accounts:index";
const source = new EncryptedFileKeyring(importDirectory);
const runtime = new EncryptedFileKeyring(runtimeDirectory);
const sourceIndex = JSON.parse((await source.getSecret(indexKey)) ?? "[]");
if (!Array.isArray(sourceIndex)) throw new Error("source account index is invalid");
const codexIds = [];
for (const accountId of sourceIndex) {
  if (typeof accountId !== "string") continue;
  const publicKey = `sentropic-llm-mesh:${accountId}:public`;
  const publicRecord = await source.getSecret(publicKey);
  if (!publicRecord) continue;
  const parsed = JSON.parse(publicRecord);
  if (parsed.account?.transportProviderId !== "codex") continue;
  if (parsed.account?.targetProviderId !== "openai") throw new Error("Codex account has an unexpected target provider");
  const envelopeKey = `sentropic-llm-mesh:${accountId}:envelope`;
  const envelope = await source.getSecret(envelopeKey);
  if (!envelope) throw new Error("Codex account envelope is missing");
  await runtime.setSecret(publicKey, publicRecord);
  await runtime.setSecret(envelopeKey, envelope);
  codexIds.push(accountId);
}
if (codexIds.length !== 1) throw new Error(`expected exactly one Codex account, found ${codexIds.length}`);
const runtimeIndex = JSON.parse((await runtime.getSecret(indexKey)) ?? "[]");
if (!Array.isArray(runtimeIndex)) throw new Error("runtime account index is invalid");
await runtime.setSecret(indexKey, JSON.stringify([...new Set([...runtimeIndex, ...codexIds])]));
const pseudonym = `acct-${createHash("sha256").update(codexIds[0]).digest("hex").slice(0, 10)}`;
console.log(JSON.stringify({ status: "imported", account: pseudonym, transport: "codex" }));
