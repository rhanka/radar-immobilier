import { describe, expect, it, vi } from "vitest";
import type { ActivationConfig } from "./activation.js";
import type { AdmissionAuthority } from "./admission.js";
import { createArtifactControl, createMemoryCommitLedger } from "./facade.js";
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
