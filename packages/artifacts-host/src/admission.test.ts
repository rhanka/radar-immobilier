import { controlTestHost } from "./control-test-host.js";
import { describe, expect, it, vi } from "vitest";
import type { ActivationConfig } from "./activation.js";
import {
  checkAdmission,
  createAdmissionAuthority,
  type AdmissionAuthority,
} from "./admission.js";
import { createArtifactControl } from "./facade.js";

const NOW = Date.parse("2026-10-21T00:00:00Z");
const FUTURE = Date.parse("2026-10-22T00:00:00Z");
const PAST = Date.parse("2026-10-20T00:00:00Z");
const ARTIFACT = "123e4567-e89b-12d3-a456-426614174000";
const RELEASE = "123e4567-e89b-12d3-a456-426614174001";
const DIGEST = "ab".repeat(32);

const live = (subjects: string[] = ["alice"]): ActivationConfig =>
  ({ enabled: true, subjects, expiresAtMs: FUTURE });
const expired: ActivationConfig = { enabled: false, reason: "activation_expired" };
const closed: ActivationConfig = { enabled: false, reason: "activation_off" };

interface Harness {
  readonly authority: AdmissionAuthority;
  readonly statusCalls: string[];
}

function harness(activations: ActivationConfig[], statuses: Array<string | null>): Harness {
  const statusCalls: string[] = [];
  let activationIndex = 0;
  let statusIndex = 0;
  return {
    authority: {
      readActivation: () => activations[Math.min(activationIndex++, activations.length - 1)]!,
      readStatus: async (sub: string) => {
        statusCalls.push(sub);
        return statuses[Math.min(statusIndex++, statuses.length - 1)]!;
      },
      nowMs: () => NOW,
    },
    statusCalls,
  };
}

function stubHost() {
  // Complete provider receipt: with the guards removed the facade maps this
  // to a publication receipt instead of throwing before the assertions.
  const handle = vi.fn(async () => ({ status: 201,
    body: { artifactId: ARTIFACT, releaseId: RELEASE, manifest: JSON.stringify({ digest: DIGEST }) } }));
  const host = controlTestHost(handle);
  return { host, handle };
}

const ensureBody = { bindingName: "summer", idempotencyKey: "key" };
const publishBody = {
  artifactId: ARTIFACT,
  files: [{ path: "index.html", mimeType: "text/html", text: "hello" }],
  idempotencyKey: "key",
};

describe("admission refusals without storage mutation [T02 T05 T17 T24]", () => {
  it("refuses an approved non-cohort subject before touching storage", async () => {
    const { authority, statusCalls } = harness([live()], ["approved"]);
    const { host, handle } = stubHost();
    const response = await createArtifactControl(host, "scope", "pages.example.test", authority)
      .handle("ensure", "bob", ensureBody);
    expect(response).toEqual({ status: 403, body: { error: "not_in_cohort" } });
    expect(handle).not.toHaveBeenCalled();
    expect(statusCalls).toEqual([]);
  });

  it("refuses suspended, pending and unknown accounts before touching storage", async () => {
    for (const [stored, expected] of [
      ["suspended", "suspended"], ["pending", "pending"], [null, "unknown"],
    ] as const) {
      const { authority } = harness([live()], [stored]);
      const { host, handle } = stubHost();
      const response = await createArtifactControl(host, "scope", "pages.example.test", authority)
        .handle("ensure", "alice", ensureBody);
      expect(response, String(stored)).toEqual(
        { status: 403, body: { error: "account_not_approved", status: expected } });
      expect(handle, String(stored)).not.toHaveBeenCalled();
    }
  });

  it("refuses reads for non-cohort subjects before touching storage", async () => {
    const { authority } = harness([live()], ["approved"]);
    const { host, handle } = stubHost();
    // Valid artifactId: without admission this request would reach storage,
    // so the refusal below proves the entry guard rather than request validation.
    const response = await createArtifactControl(host, "scope", "pages.example.test", authority)
      .handle("meta", "bob", { artifactId: ARTIFACT });
    expect(response).toEqual({ status: 403, body: { error: "not_in_cohort" } });
    expect(handle).not.toHaveBeenCalled();
  });

  it("refuses every closed activation before touching storage or accounts", async () => {
    const closedVariants: ActivationConfig[] = [
      closed,
      { enabled: false, reason: "activation_absent" },
      { enabled: false, reason: "activation_incomplete", missing: ["ARTIFACTS_CONTROL_MODE"] },
      expired,
      { enabled: true, subjects: ["alice"], expiresAtMs: PAST },
    ];
    for (const activation of closedVariants) {
      const { authority, statusCalls } = harness([activation], ["approved"]);
      const { host, handle } = stubHost();
      const response = await createArtifactControl(host, "scope", "pages.example.test", authority)
        .handle("publish", "alice", publishBody);
      expect(response).toEqual({ status: 403, body: { error: "activation_closed" } });
      expect(handle).not.toHaveBeenCalled();
      expect(statusCalls).toEqual([]);
    }
  });

  it("passes an approved cohort subject through to storage", async () => {
    const { authority } = harness([live()], ["approved"]);
    const { host, handle } = stubHost();
    const response = await createArtifactControl(host, "scope", "pages.example.test", authority)
      .handle("ensure", "alice", ensureBody);
    expect(response.status).toBe(201);
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it("publishes with H3 admission and returns a complete receipt", async () => {
    const { authority } = harness([live(), live()], ["approved", "approved"]);
    const { host, handle } = stubHost();
    const response = await createArtifactControl(host, "scope", "pages.example.test", authority)
      .handle("publish", "alice", publishBody);
    expect(response).toEqual({ status: 201,
      body: { artifactId: ARTIFACT, releaseId: RELEASE, manifest: JSON.stringify({ digest: DIGEST }), digest: DIGEST,
        stableUrl: `https://${ARTIFACT}.pages.example.test/`,
        pinnedUrl: `https://${RELEASE}.pinned.pages.example.test/` } });
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it("refuses at entry when activation is already closed", async () => {
    const { authority, statusCalls } = harness([expired], ["approved"]);
    const { host, handle } = stubHost();
    const response = await createArtifactControl(host, "scope", "pages.example.test", authority)
      .handle("publish", "alice", publishBody);
    expect(response).toEqual({ status: 403, body: { error: "activation_closed" } });
    expect(handle).not.toHaveBeenCalled();
    expect(statusCalls).toEqual([]);
  });
});

describe("createAdmissionAuthority", () => {
  it("rereads account_users through the exact H2 status query", async () => {
    const calls: Array<{ text: string; params: readonly unknown[] }> = [];
    const authority = createAdmissionAuthority({
      async query(text: string, params: unknown[] = []) {
        calls.push({ text, params });
        return { rows: [{ status: "approved" }] };
      },
    }, () => live(), () => NOW);
    await expect(checkAdmission(authority, "alice")).resolves.toEqual({ allowed: true, workspaceId: "" });
    expect(calls).toEqual([{
      text: "SELECT status FROM account_users WHERE sub = $1 LIMIT 1",
      params: ["alice"],
    }]);
  });
});
