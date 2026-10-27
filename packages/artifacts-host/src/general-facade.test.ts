import { controlTestHost } from "./control-test-host.js";
import { describe, expect, it, vi } from "vitest";
import type { AdmissionAuthority } from "./admission.js";
import { createArtifactControl, createMemoryCommitLedger } from "./facade.js";
import { rateLimitedOutcome } from "./attempt-admission.js";
import { ARTIFACT, DIGEST, NOW, RELEASE, SCOPE, ensureBody, general, stubAuthority, stubHost } from "./general-harness.js";

describe("general facade without frozen workspace", () => {
  it("publishes with two memberships without ever consulting them", async () => {
    const { authority, membershipCalls } = stubAuthority({ memberships: [["w-1", "w-2"]] });
    const { host, handle } = stubHost();
    const response = await createArtifactControl(host, SCOPE, "pages.example.test", authority)
      .handle("publish", "alice", {
        artifactId: ARTIFACT,
        files: [{ path: "index.html", mimeType: "text/html", text: "hello" }],
        idempotencyKey: "key",
      });
    expect(response.status).toBe(201);
    expect(handle).toHaveBeenCalledTimes(1);
    expect(membershipCalls).toEqual([]);
  });

  it("refuses at commit when the account is suspended after entry", async () => {
    const { authority } = stubAuthority({ statuses: ["approved", "suspended"] });
    const { host, handle } = stubHost();
    const response = await createArtifactControl(host, SCOPE, "pages.example.test", authority)
      .handle("ensure", "alice", ensureBody);
    expect(response).toEqual(
      { status: 403, body: { error: "account_not_approved", status: "suspended" } });
    expect(handle).not.toHaveBeenCalled();
  });

  it("refuses at finalization when the account is suspended while the provider is blocked", async () => {
    let status = "approved";
    const authority: AdmissionAuthority = {
      readActivation: () => general(), nowMs: () => NOW, readStatus: async () => status,
    };
    let release!: (value: { status: number; body: unknown }) => void;
    const gate = new Promise<{ status: number; body: unknown }>((done) => { release = done; });
    const handle = vi.fn(async () => gate);
    const host = controlTestHost(handle);
    const { ledger, entries } = createMemoryCommitLedger();
    const pending = createArtifactControl(host, SCOPE, "pages.example.test", authority,
      { ledger, nowMs: () => NOW }).handle("publish", "alice", {
      artifactId: ARTIFACT,
      files: [{ path: "index.html", mimeType: "text/html", text: "hello" }],
      idempotencyKey: "key",
    });
    await vi.waitFor(() => expect(handle).toHaveBeenCalled());
    status = "suspended";
    release({ status: 201,
      body: { artifactId: ARTIFACT, releaseId: RELEASE, manifest: JSON.stringify({ digest: DIGEST }) } });
    await expect(pending).resolves.toEqual(
      { status: 403, body: { error: "account_not_approved" } });
    expect(entries).toEqual([{ invocationId: expect.any(String), op: "publish", actorId: "alice",
      reason: "unauthorized_at_commit", status: 403, atMs: NOW }]);
  });
});

describe("general facade temporary admission refusal", () => {
  it("preserves retryable rate refusal without recording a commit failure", async () => {
    const { authority } = stubAuthority({});
    const { host } = stubHost();
    const limited = { ...host, execute: vi.fn(async () => rateLimitedOutcome("id", "ensure")) };
    const { ledger, entries } = createMemoryCommitLedger();
    const response = await createArtifactControl(limited, SCOPE, "pages.example.test", authority, { ledger })
      .handle("ensure", "alice", ensureBody);
    expect(response).toMatchObject({ status: 429, body: { error: "rate_limited", retryable: true }, retryable: true });
    expect(entries).toEqual([]);
  });
});
