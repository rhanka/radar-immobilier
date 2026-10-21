import { describe, expect, it, vi } from "vitest";
import type { ActivationConfig } from "./activation.js";
import type { AdmissionAuthority } from "./admission.js";
import {
  createArtifactControl,
  createMemoryCommitLedger,
  createMemoryProviderProbe,
} from "./facade.js";
import { ArtifactConnectionError } from "./idempotency.js";
import { ArtifactS3TimeoutError } from "./s3-timeout.js";

const NOW = Date.parse("2026-10-21T00:00:00Z");
const FUTURE = Date.parse("2026-10-22T00:00:00Z");
const ARTIFACT = "123e4567-e89b-12d3-a456-426614174000";

const live = (): ActivationConfig =>
  ({ enabled: true, subjects: ["alice"], expiresAtMs: FUTURE });

const publishBody = {
  artifactId: ARTIFACT,
  files: [{ path: "index.html", mimeType: "text/html", text: "hello" }],
  idempotencyKey: "key",
};

type ProviderBody = { readonly status: number; readonly body: unknown };

describe("provider failure accounting [T05 T13]", () => {
  it.each([
    ["s3 timeout", new ArtifactS3TimeoutError("blobs.putBlob")],
    ["connection loss", new ArtifactConnectionError()],
  ])("maps a blocked %s to 503 and accounts it", async (_name, failure) => {
    const authority: AdmissionAuthority = {
      readActivation: () => live(), nowMs: () => NOW, readStatus: async () => "approved",
    };
    const handle = vi.fn(async (): Promise<ProviderBody> => { throw failure; });
    const host = { app: { handle } } as unknown as Parameters<typeof createArtifactControl>[0];
    const { ledger, entries } = createMemoryCommitLedger();
    const response = await createArtifactControl(host, "scope", "pages.example.test", authority,
      { ledger, nowMs: () => NOW }).handle("publish", "alice", publishBody);
    expect(response).toEqual({ status: 503, body: { error: "capability_unavailable" } });
    expect(handle).toHaveBeenCalledTimes(1);
    expect(entries).toEqual([{ op: "publish", actorId: "alice",
      reason: "provider_unavailable", status: 503, atMs: NOW }]);
  });

  it("maps a lock-timeout throw to 409 and accounts it", async () => {
    const authority: AdmissionAuthority = {
      readActivation: () => live(), nowMs: () => NOW, readStatus: async () => "approved",
    };
    const handle = vi.fn(async (): Promise<ProviderBody> => {
      throw new Error("artifact advisory lock timeout conflict");
    });
    const host = { app: { handle } } as unknown as Parameters<typeof createArtifactControl>[0];
    const { ledger, entries } = createMemoryCommitLedger();
    const response = await createArtifactControl(host, "scope", "pages.example.test", authority,
      { ledger, nowMs: () => NOW }).handle("ensure", "alice",
      { bindingName: "summer", idempotencyKey: "key" });
    expect(response).toEqual({ status: 409, body: { error: "conflict" } });
    expect(entries).toEqual([{ op: "ensure", actorId: "alice",
      reason: "provider_conflict", status: 409, atMs: NOW }]);
  });

  it("accounts a returned 409 without changing its body", async () => {
    const authority: AdmissionAuthority = {
      readActivation: () => live(), nowMs: () => NOW, readStatus: async () => "approved",
    };
    const handle = vi.fn(async (): Promise<ProviderBody> =>
      ({ status: 409, body: { error: "conflict" } }));
    const host = { app: { handle } } as unknown as Parameters<typeof createArtifactControl>[0];
    const { ledger, entries } = createMemoryCommitLedger();
    const response = await createArtifactControl(host, "scope", "pages.example.test", authority,
      { ledger, nowMs: () => NOW }).handle("ensure", "alice",
      { bindingName: "summer", idempotencyKey: "key" });
    expect(response).toEqual({ status: 409, body: { error: "conflict" } });
    expect(entries).toEqual([{ op: "ensure", actorId: "alice",
      reason: "provider_conflict", status: 409, atMs: NOW }]);
  });

  it.each(["meta", "list"])("never accounts a failed %s read", async (op) => {
    const handle = vi.fn(async (): Promise<ProviderBody> => { throw new ArtifactConnectionError(); });
    const host = { app: { handle } } as unknown as Parameters<typeof createArtifactControl>[0];
    const { ledger, entries } = createMemoryCommitLedger();
    const response = await createArtifactControl(host, "scope", "pages.example.test", undefined,
      { ledger, nowMs: () => NOW }).handle(op, "alice", { artifactId: ARTIFACT });
    expect(response).toEqual({ status: 503, body: { error: "capability_unavailable" } });
    expect(handle).toHaveBeenCalledTimes(1);
    expect(entries).toEqual([]);
  });
});

describe("preserved provider cause below the HTTP layer [T05 T13]", () => {
  const RELEASE = "123e4567-e89b-12d3-a456-426614174001";
  const DIGEST = "ab".repeat(32);
  const authority = (): AdmissionAuthority => ({
    readActivation: live, nowMs: () => NOW, readStatus: async () => "approved",
  });

  function convertedHost(
    behavior: () => Promise<ProviderBody>,
  ): Parameters<typeof createArtifactControl>[0] {
    const handle = vi.fn(async (): Promise<ProviderBody> => behavior());
    return { app: { handle } } as unknown as Parameters<typeof createArtifactControl>[0];
  }

  function receiptBody() {
    return { artifactId: ARTIFACT, releaseId: RELEASE, manifest: JSON.stringify({ digest: DIGEST }) };
  }

  it("remaps a converted 500 from an S3 timeout to 503", async () => {
    const probe = createMemoryProviderProbe();
    const host = convertedHost(async () => {
      probe.record(new ArtifactS3TimeoutError("blobs.putBlob"));
      return { status: 500, body: { error: "internal_error" } };
    });
    const { ledger, entries } = createMemoryCommitLedger();
    const response = await createArtifactControl(host, "scope", "pages.example.test", authority(),
      { ledger, nowMs: () => NOW, probe }).handle("publish", "alice", publishBody);
    expect(response).toEqual({ status: 503, body: { error: "capability_unavailable" } });
    expect(entries).toEqual([{ op: "publish", actorId: "alice",
      reason: "provider_unavailable", status: 503, atMs: NOW }]);
  });

  it("remaps a converted 409 from a lost connection to 503", async () => {
    const probe = createMemoryProviderProbe();
    const host = convertedHost(async () => {
      probe.record(new ArtifactConnectionError("artifact postgres connection lost"));
      return { status: 409, body: { error: "conflict" } };
    });
    const { ledger, entries } = createMemoryCommitLedger();
    const response = await createArtifactControl(host, "scope", "pages.example.test", authority(),
      { ledger, nowMs: () => NOW, probe }).handle("publish", "alice", publishBody);
    expect(response).toEqual({ status: 503, body: { error: "capability_unavailable" } });
    expect(entries).toEqual([{ op: "publish", actorId: "alice",
      reason: "provider_unavailable", status: 503, atMs: NOW }]);
  });

  it("keeps a converted 409 for a lock conflict as 409", async () => {
    const probe = createMemoryProviderProbe();
    const host = convertedHost(async () => {
      probe.record(new Error("artifact advisory lock timeout conflict"));
      return { status: 409, body: { error: "conflict" } };
    });
    const { ledger, entries } = createMemoryCommitLedger();
    const response = await createArtifactControl(host, "scope", "pages.example.test", authority(),
      { ledger, nowMs: () => NOW, probe }).handle("ensure", "alice",
      { bindingName: "summer", idempotencyKey: "key" });
    expect(response).toEqual({ status: 409, body: { error: "conflict" } });
    expect(entries).toEqual([{ op: "ensure", actorId: "alice",
      reason: "provider_conflict", status: 409, atMs: NOW }]);
  });

  it("prefers the preserved cause when dispatch itself throws", async () => {
    const probe = createMemoryProviderProbe();
    const host = convertedHost(async () => {
      probe.record(new ArtifactS3TimeoutError("blobs.putBlob"));
      throw new Error("upstream gone");
    });
    const { ledger, entries } = createMemoryCommitLedger();
    const response = await createArtifactControl(host, "scope", "pages.example.test", authority(),
      { ledger, nowMs: () => NOW, probe }).handle("publish", "alice", publishBody);
    expect(response).toEqual({ status: 503, body: { error: "capability_unavailable" } });
    expect(entries).toEqual([{ op: "publish", actorId: "alice",
      reason: "provider_unavailable", status: 503, atMs: NOW }]);
  });

  it("drops a stale cause when the provider recovered with success", async () => {
    const probe = createMemoryProviderProbe();
    const host = convertedHost(async () => {
      probe.record(new ArtifactS3TimeoutError("blobs.putBlob"));
      return { status: 201, body: receiptBody() };
    });
    const { ledger, entries } = createMemoryCommitLedger();
    const response = await createArtifactControl(host, "scope", "pages.example.test", authority(),
      { ledger, nowMs: () => NOW, probe }).handle("publish", "alice", publishBody);
    expect(response.status).toBe(201);
    expect((response.body as { releaseId: string }).releaseId).toBe(RELEASE);
    expect(entries).toEqual([]);
    expect(probe.take()).toBeUndefined();
  });

  it("drains a preserved cause on reads without remapping them", async () => {
    const probe = createMemoryProviderProbe();
    const host = convertedHost(async () => {
      probe.record(new ArtifactConnectionError());
      return { status: 500, body: { error: "internal_error" } };
    });
    const { ledger, entries } = createMemoryCommitLedger();
    const response = await createArtifactControl(host, "scope", "pages.example.test", authority(),
      { ledger, nowMs: () => NOW, probe }).handle("meta", "alice", { artifactId: ARTIFACT });
    expect(response).toEqual({ status: 500, body: { error: "internal_error" } });
    expect(entries).toEqual([]);
    expect(probe.take()).toBeUndefined();
  });

  it("keeps concurrent converted failures bound to their dispatch", async () => {
    const probe = createMemoryProviderProbe();
    let entered!: () => void;
    let resume!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const released = new Promise<void>((resolve) => { resume = resolve; });
    let calls = 0;
    const host = convertedHost(async () => {
      if (++calls === 1) {
        probe.record(new ArtifactS3TimeoutError("blobs.putBlob"));
        entered();
        await released;
        return { status: 500, body: { error: "internal_error" } };
      }
      return { status: 409, body: { error: "conflict" } };
    });
    const { ledger, entries } = createMemoryCommitLedger();
    const control = createArtifactControl(host, "scope", "pages.example.test", undefined,
      { ledger, nowMs: () => NOW, probe });
    const first = control.handle("publish", "alice", publishBody);
    await started;
    const second = await control.handle("publish", "bob", publishBody);
    resume();
    expect(second).toEqual({ status: 409, body: { error: "conflict" } });
    expect(await first).toEqual({ status: 503, body: { error: "capability_unavailable" } });
    expect(entries).toEqual([
      { op: "publish", actorId: "bob", reason: "provider_conflict", status: 409, atMs: NOW },
      { op: "publish", actorId: "alice", reason: "provider_unavailable", status: 503, atMs: NOW },
    ]);
  });
});
