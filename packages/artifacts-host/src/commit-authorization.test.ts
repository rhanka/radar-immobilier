import { controlTestHost } from "./control-test-host.js";
import { describe, expect, it, vi } from "vitest";
import type { ActivationConfig } from "./activation.js";
import type { AdmissionAuthority } from "./admission.js";
import { createArtifactControl, createMemoryCommitLedger } from "./facade.js";

const NOW = Date.parse("2026-10-21T00:00:00Z");
const FUTURE = Date.parse("2026-10-22T00:00:00Z");
const ARTIFACT = "123e4567-e89b-12d3-a456-426614174000";
const RELEASE = "123e4567-e89b-12d3-a456-426614174001";
const DIGEST = "ab".repeat(32);

const live = (subjects: string[] = ["alice"]): ActivationConfig =>
  ({ enabled: true, subjects, expiresAtMs: FUTURE });

function receiptBody() {
  return { artifactId: ARTIFACT, releaseId: RELEASE, manifest: JSON.stringify({ digest: DIGEST }) };
}

const publishBody = {
  artifactId: ARTIFACT,
  files: [{ path: "index.html", mimeType: "text/html", text: "hello" }],
  idempotencyKey: "key",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>((res) => { resolve = res; }), resolve };
}

type ProviderBody = { readonly status: number; readonly body: unknown };

function blockedProvider() {
  const gate = deferred<ProviderBody>();
  const handle = vi.fn(async (): Promise<ProviderBody> => gate.promise);
  const host = controlTestHost(handle);
  return { host, handle, gate };
}

describe("commit-time authorization while the provider is blocked [T05 T13]", () => {
  it.each(["ensure", "publish"])("accounts admission unavailability before finalization for %s", async (op) => {
    let unavailable = false;
    const authority: AdmissionAuthority = {
      readActivation: () => live(), nowMs: () => NOW,
      readStatus: async () => {
        if (unavailable) throw new Error("private database query and storage identifiers");
        return "approved";
      },
    };
    const { host, handle, gate } = blockedProvider();
    const { ledger, entries } = createMemoryCommitLedger();
    const pending = createArtifactControl(host, "scope", "pages.example.test", authority,
      { ledger, nowMs: () => NOW }).handle(op, "alice", op === "publish" ? publishBody :
      { bindingName: "summer", idempotencyKey: "key" });
    await vi.waitFor(() => expect(handle).toHaveBeenCalledTimes(1));
    unavailable = true;
    gate.resolve({ status: 201, body: receiptBody() });
    await expect(pending).resolves.toEqual(
      { status: 503, body: { error: "capability_unavailable" } });
    expect(entries).toEqual([{ op, actorId: "alice",
      reason: "unauthorized_at_commit", status: 503, atMs: NOW }]);
  });

  it("refuses a publish suspended while the provider is blocked", async () => {
    let status = "approved";
    const authority: AdmissionAuthority = {
      readActivation: () => live(), nowMs: () => NOW, readStatus: async () => status,
    };
    const { host, handle, gate } = blockedProvider();
    const { ledger, entries } = createMemoryCommitLedger();
    const pending = createArtifactControl(host, "scope", "pages.example.test", authority,
      { ledger, nowMs: () => NOW }).handle("publish", "alice", publishBody);
    await vi.waitFor(() => expect(handle).toHaveBeenCalled());
    status = "suspended";
    gate.resolve({ status: 201, body: receiptBody() });
    expect(await pending).toEqual(
      { status: 403, body: { error: "account_not_approved" } });
    expect(entries).toEqual([{ invocationId: expect.any(String), op: "publish", actorId: "alice",
      reason: "unauthorized_at_commit", status: 403, atMs: NOW }]);
  });

  it("refuses a publish leaving the cohort while the provider is blocked", async () => {
    let subjects = ["alice"];
    const authority: AdmissionAuthority = {
      readActivation: () => live(subjects), nowMs: () => NOW, readStatus: async () => "approved",
    };
    const { host, handle, gate } = blockedProvider();
    const { ledger, entries } = createMemoryCommitLedger();
    const pending = createArtifactControl(host, "scope", "pages.example.test", authority,
      { ledger, nowMs: () => NOW }).handle("publish", "alice", publishBody);
    await vi.waitFor(() => expect(handle).toHaveBeenCalled());
    subjects = ["bob"];
    gate.resolve({ status: 201, body: receiptBody() });
    expect(await pending).toEqual({ status: 403, body: { error: "not_in_cohort" } });
    expect(entries).toEqual([{ invocationId: expect.any(String), op: "publish", actorId: "alice",
      reason: "unauthorized_at_commit", status: 403, atMs: NOW }]);
  });

  it("refuses a publish expiring while the provider is blocked", async () => {
    let now = NOW;
    const authority: AdmissionAuthority = {
      readActivation: () => live(), nowMs: () => now, readStatus: async () => "approved",
    };
    const { host, handle, gate } = blockedProvider();
    const { ledger, entries } = createMemoryCommitLedger();
    const pending = createArtifactControl(host, "scope", "pages.example.test", authority,
      { ledger, nowMs: () => NOW }).handle("publish", "alice", publishBody);
    await vi.waitFor(() => expect(handle).toHaveBeenCalled());
    now = FUTURE;
    gate.resolve({ status: 201, body: receiptBody() });
    expect(await pending).toEqual({ status: 403, body: { error: "activation_closed" } });
    expect(entries).toEqual([{ invocationId: expect.any(String), op: "publish", actorId: "alice",
      reason: "unauthorized_at_commit", status: 403, atMs: NOW }]);
  });

  it("receipts a publish that settles while admission holds", async () => {
    const authority: AdmissionAuthority = {
      readActivation: () => live(), nowMs: () => NOW, readStatus: async () => "approved",
    };
    const { host, handle, gate } = blockedProvider();
    const { ledger, entries } = createMemoryCommitLedger();
    const pending = createArtifactControl(host, "scope", "pages.example.test", authority,
      { ledger, nowMs: () => NOW }).handle("publish", "alice", publishBody);
    await vi.waitFor(() => expect(handle).toHaveBeenCalled());
    gate.resolve({ status: 201, body: receiptBody() });
    expect(await pending).toEqual({ status: 201,
      body: { artifactId: ARTIFACT, releaseId: RELEASE, manifest: JSON.stringify({ digest: DIGEST }), digest: DIGEST,
        stableUrl: `https://${ARTIFACT}.pages.example.test/`,
        pinnedUrl: `https://${RELEASE}.pinned.pages.example.test/` } });
    expect(entries).toEqual([]);
  });
});
