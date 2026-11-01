/* global console, process */

// Imports ONE freshly enrolled account of a given transport from an owner
// keyring into the runtime keyring of an already initialized PVC.
//
//   node account-import.mjs <transport> <runtime-dir> <import-dir>
//
// <transport> is `codex` (target openai) or `cloud-code` (target gemini).
// Every runtime account of the SAME transport and owner scope is replaced
// (public record, envelope and owner claim deleted, index entry dropped), so a
// re-authorization never leaves a stale, unroutable account behind. Accounts of
// any OTHER transport are left byte-for-byte untouched: their credentials were
// refreshed on the PVC and are newer than any copy in the owner keyring.

import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export const ACCOUNT_INDEX_KEY = "sentropic-llm-mesh:accounts:index";
export const IMPORT_TRANSPORTS = Object.freeze({ codex: "openai", "cloud-code": "gemini" });

const recordKey = (accountId, kind) => `sentropic-llm-mesh:${accountId}:${kind}`;

async function readIndex(keyring, label) {
  const index = JSON.parse((await keyring.getSecret(ACCOUNT_INDEX_KEY)) ?? "[]");
  if (!Array.isArray(index)) throw new Error(`${label} account index is invalid`);
  return index.filter((accountId) => typeof accountId === "string");
}

async function readPublic(keyring, accountId) {
  const raw = await keyring.getSecret(recordKey(accountId, "public"));
  return raw ? { raw, parsed: JSON.parse(raw) } : null;
}

/**
 * @param {{ transport: string, source: KeyringLike, runtime: KeyringLike, ownerScopeRef: string }} input
 * @typedef {{ getSecret(key: string): Promise<string | null | undefined>,
 *   setSecret(key: string, value: string): Promise<void>, deleteSecret(key: string): Promise<void> }} KeyringLike
 */
export async function importAccount({ transport, source, runtime, ownerScopeRef }) {
  const target = IMPORT_TRANSPORTS[transport];
  if (!target) throw new Error(`unsupported import transport: ${transport}`);
  if (!ownerScopeRef) throw new Error("runtime owner scope is required");

  const imported = [];
  for (const accountId of await readIndex(source, "source")) {
    const record = await readPublic(source, accountId);
    if (record?.parsed.account?.transportProviderId !== transport) continue;
    // An owner keyring may hold accounts of other owner scopes: never import them.
    if (record.parsed.account?.ownerScopeRef !== ownerScopeRef) continue;
    if (record.parsed.account?.targetProviderId !== target) {
      throw new Error(`${transport} account has an unexpected target provider`);
    }
    const envelope = await source.getSecret(recordKey(accountId, "envelope"));
    if (!envelope) throw new Error(`${transport} account envelope is missing`);
    const owner = await source.getSecret(recordKey(accountId, "owner"));
    imported.push({ accountId, publicRecord: record.raw, envelope, owner });
  }
  if (imported.length !== 1) throw new Error(`expected exactly one ${transport} account, found ${imported.length}`);
  const [account] = imported;
  if (await runtime.getSecret(recordKey(account.accountId, "removed"))) {
    throw new Error(`${transport} account was removed from the runtime keyring`);
  }

  const runtimeIndex = await readIndex(runtime, "runtime");
  const replaced = [];
  for (const accountId of runtimeIndex) {
    if (accountId === account.accountId) continue;
    const record = await readPublic(runtime, accountId);
    if (record?.parsed.account?.transportProviderId !== transport) continue;
    if (record.parsed.account?.ownerScopeRef !== ownerScopeRef) continue;
    replaced.push(accountId);
  }

  // Write the new account first: an interruption leaves an extra account, never none.
  await runtime.setSecret(recordKey(account.accountId, "envelope"), account.envelope);
  if (account.owner) await runtime.setSecret(recordKey(account.accountId, "owner"), account.owner);
  await runtime.setSecret(recordKey(account.accountId, "public"), account.publicRecord);
  const nextIndex = [...new Set([...runtimeIndex.filter((id) => !replaced.includes(id)), account.accountId])];
  await runtime.setSecret(ACCOUNT_INDEX_KEY, JSON.stringify(nextIndex));
  for (const accountId of replaced) {
    for (const kind of ["public", "envelope", "owner"]) await runtime.deleteSecret(recordKey(accountId, kind));
  }

  const pseudonym = (accountId) => `acct-${createHash("sha256").update(accountId).digest("hex").slice(0, 10)}`;
  return { status: "imported", transport, account: pseudonym(account.accountId),
    replaced: replaced.map(pseudonym), accounts: nextIndex.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [transport, runtimeDirectory, importDirectory] = process.argv.slice(2);
  if (!transport || !runtimeDirectory || !importDirectory) {
    throw new Error("usage: account-import.mjs <transport> <runtime-dir> <import-dir>");
  }
  const { EncryptedFileKeyring } = await import("@sentropic/llm-mesh-refresh/node");
  const result = await importAccount({ transport,
    source: new EncryptedFileKeyring(importDirectory),
    runtime: new EncryptedFileKeyring(runtimeDirectory),
    ownerScopeRef: process.env.REFRESH_OWNER_SCOPE_REF ?? "" });
  console.log(JSON.stringify(result));
}
