/* global console */

// Hermetic selftest of account-import.mjs: in-memory keyrings, no cluster.
//   node deploy/k8s/refresh-cronjobs/keyring-import/account-import.selftest.mjs

import assert from "node:assert/strict";
import { test } from "node:test";

import { ACCOUNT_INDEX_KEY, importAccount } from "./account-import.mjs";

const OWNER = "owner-scope-test";

function memoryKeyring(entries = {}) {
  const store = new Map(Object.entries(entries));
  return {
    store,
    async getSecret(key) { return store.get(key) ?? null; },
    async setSecret(key, value) { store.set(key, value); },
    async deleteSecret(key) { store.delete(key); },
  };
}

function account(accountId, transportProviderId, targetProviderId, { owner = OWNER, secret = `${accountId}-token` } = {}) {
  return {
    [`sentropic-llm-mesh:${accountId}:public`]: JSON.stringify({ accountId,
      account: { accountId, transportProviderId, targetProviderId, ownerScopeRef: owner } }),
    [`sentropic-llm-mesh:${accountId}:envelope`]: JSON.stringify({ sealed: secret }),
    [`sentropic-llm-mesh:${accountId}:owner`]: JSON.stringify({ v: 1, accountId, ownerScopeRef: owner }),
  };
}

const index = (...ids) => ({ [ACCOUNT_INDEX_KEY]: JSON.stringify(ids) });

test("re-authorized cloud-code account replaces the stale one and keeps refreshed Codex untouched", async () => {
  const runtime = memoryKeyring({ ...index("codex-1", "cc-old"),
    ...account("codex-1", "codex", "openai", { secret: "codex-refreshed-on-pvc" }),
    ...account("cc-old", "cloud-code", "gemini") });
  const source = memoryKeyring({ ...index("codex-1", "cc-new"),
    ...account("codex-1", "codex", "openai", { secret: "codex-stale-owner-copy" }),
    ...account("cc-new", "cloud-code", "gemini") });
  const codexBefore = runtime.store.get("sentropic-llm-mesh:codex-1:envelope");

  const result = await importAccount({ transport: "cloud-code", source, runtime, ownerScopeRef: OWNER });

  assert.deepEqual(JSON.parse(runtime.store.get(ACCOUNT_INDEX_KEY)), ["codex-1", "cc-new"]);
  assert.equal(runtime.store.get("sentropic-llm-mesh:codex-1:envelope"), codexBefore);
  assert.equal(runtime.store.get("sentropic-llm-mesh:cc-new:envelope"), source.store.get("sentropic-llm-mesh:cc-new:envelope"));
  assert.ok(runtime.store.has("sentropic-llm-mesh:cc-new:owner"));
  for (const kind of ["public", "envelope", "owner"]) {
    assert.equal(runtime.store.has(`sentropic-llm-mesh:cc-old:${kind}`), false, `stale ${kind} removed`);
  }
  assert.equal(result.transport, "cloud-code");
  assert.equal(result.replaced.length, 1);
  assert.equal(result.accounts, 2);
  assert.doesNotMatch(JSON.stringify(result), /cc-new|cc-old|token/);
});

test("re-importing the same account id overwrites it without duplicating the index", async () => {
  const runtime = memoryKeyring({ ...index("cc-1"), ...account("cc-1", "cloud-code", "gemini", { secret: "expired" }) });
  const source = memoryKeyring({ ...index("cc-1"), ...account("cc-1", "cloud-code", "gemini", { secret: "fresh" }) });
  const result = await importAccount({ transport: "cloud-code", source, runtime, ownerScopeRef: OWNER });
  assert.deepEqual(JSON.parse(runtime.store.get(ACCOUNT_INDEX_KEY)), ["cc-1"]);
  assert.match(runtime.store.get("sentropic-llm-mesh:cc-1:envelope"), /fresh/);
  assert.deepEqual(result.replaced, []);
});

test("codex transport keeps its previous behaviour and leaves cloud-code untouched", async () => {
  const runtime = memoryKeyring({ ...index("cc-1"), ...account("cc-1", "cloud-code", "gemini") });
  const source = memoryKeyring({ ...index("codex-1"), ...account("codex-1", "codex", "openai") });
  await importAccount({ transport: "codex", source, runtime, ownerScopeRef: OWNER });
  assert.deepEqual(JSON.parse(runtime.store.get(ACCOUNT_INDEX_KEY)), ["cc-1", "codex-1"]);
  assert.ok(runtime.store.has("sentropic-llm-mesh:cc-1:envelope"));
});

test("an account of another owner scope in the runtime is never replaced", async () => {
  const runtime = memoryKeyring({ ...index("cc-other"), ...account("cc-other", "cloud-code", "gemini", { owner: "someone-else" }) });
  const source = memoryKeyring({ ...index("cc-new"), ...account("cc-new", "cloud-code", "gemini") });
  await importAccount({ transport: "cloud-code", source, runtime, ownerScopeRef: OWNER });
  assert.deepEqual(JSON.parse(runtime.store.get(ACCOUNT_INDEX_KEY)), ["cc-other", "cc-new"]);
  assert.ok(runtime.store.has("sentropic-llm-mesh:cc-other:public"));
});

test("refuses unsafe inputs before writing anything", async () => {
  const cases = [
    ["unknown transport", { transport: "anthropic" }, /unsupported import transport/],
    ["missing owner scope", { ownerScopeRef: "" }, /owner scope is required/],
    ["source of another owner only", { source: { ...index("cc-x"), ...account("cc-x", "cloud-code", "gemini", { owner: "other" }) } },
      /found 0/],
    ["wrong target", { source: { ...index("cc-x"), ...account("cc-x", "cloud-code", "openai") } }, /unexpected target/],
    ["no account", { source: index() }, /found 0/],
    ["two accounts", { source: { ...index("a", "b"), ...account("a", "cloud-code", "gemini"), ...account("b", "cloud-code", "gemini") } },
      /found 2/],
  ];
  for (const [label, override, error] of cases) {
    const runtimeEntries = { ...index("cc-old"), ...account("cc-old", "cloud-code", "gemini") };
    const runtime = memoryKeyring(runtimeEntries);
    const source = memoryKeyring(override.source ?? { ...index("cc-new"), ...account("cc-new", "cloud-code", "gemini") });
    await assert.rejects(importAccount({ transport: override.transport ?? "cloud-code", source, runtime,
      ownerScopeRef: override.ownerScopeRef ?? OWNER }), error, label);
    assert.deepEqual(Object.fromEntries(runtime.store), runtimeEntries, `${label}: runtime unchanged`);
  }
});

test("picks the owner's account out of a shared owner keyring holding other owner scopes", async () => {
  const runtime = memoryKeyring({ ...index("cc-old"), ...account("cc-old", "cloud-code", "gemini") });
  const source = memoryKeyring({ ...index("cc-foreign", "cc-new"),
    ...account("cc-foreign", "cloud-code", "gemini", { owner: "another-project" }),
    ...account("cc-new", "cloud-code", "gemini") });
  await importAccount({ transport: "cloud-code", source, runtime, ownerScopeRef: OWNER });
  assert.deepEqual(JSON.parse(runtime.store.get(ACCOUNT_INDEX_KEY)), ["cc-new"]);
  assert.equal(runtime.store.has("sentropic-llm-mesh:cc-foreign:public"), false);
});

test("refuses an account that carries a removal tombstone in the runtime", async () => {
  const runtime = memoryKeyring({ ...index(), "sentropic-llm-mesh:cc-new:removed": "{}" });
  const source = memoryKeyring({ ...index("cc-new"), ...account("cc-new", "cloud-code", "gemini") });
  await assert.rejects(importAccount({ transport: "cloud-code", source, runtime, ownerScopeRef: OWNER }), /removed/);
  console.log("account-import selftest: ok");
});
