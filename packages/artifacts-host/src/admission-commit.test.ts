import { describe, expect, it, vi } from "vitest";
import type { ActivationConfig } from "./activation.js";
import type { AdmissionAuthority } from "./admission.js";
import { createArtifactControl } from "./facade.js";

const NOW = Date.parse("2026-10-21T00:00:00Z");
const FUTURE = Date.parse("2026-10-22T00:00:00Z");
const ARTIFACT = "123e4567-e89b-12d3-a456-426614174000";
const RELEASE = "123e4567-e89b-12d3-a456-426614174001";
const DIGEST = "ab".repeat(32);

const live = (subjects: string[] = ["alice"]): ActivationConfig =>
  ({ enabled: true, subjects, expiresAtMs: FUTURE });
const expired: ActivationConfig = { enabled: false, reason: "activation_expired" };

function harness(activations: ActivationConfig[], statuses: Array<string | null>): AdmissionAuthority {
  let activationIndex = 0;
  let statusIndex = 0;
  return {
    readActivation: () => activations[Math.min(activationIndex++, activations.length - 1)]!,
    readStatus: async () => statuses[Math.min(statusIndex++, statuses.length - 1)]!,
    nowMs: () => NOW,
  };
}

function stubHost() {
  // Complete provider receipt: with the final reread removed the facade maps
  // this to a publication receipt instead of throwing before the assertions.
  const handle = vi.fn(async () => ({ status: 201,
    body: { artifactId: ARTIFACT, releaseId: RELEASE, manifest: JSON.stringify({ digest: DIGEST }) } }));
  const host = { app: { handle } } as unknown as Parameters<typeof createArtifactControl>[0];
  return { host, handle };
}

const publishBody = {
  artifactId: ARTIFACT,
  files: [{ path: "index.html", mimeType: "text/html", text: "hello" }],
  idempotencyKey: "key",
};

async function publishWith(authority: AdmissionAuthority) {
  const { host, handle } = stubHost();
  const response = await createArtifactControl(host, "scope", "pages.example.test", authority)
    .handle("publish", "alice", publishBody);
  return { response, handle };
}

describe("commit-time authority reread [T05 T13]", () => {
  it("refuses a publish that expires between entry and commit", async () => {
    const { response, handle } = await publishWith(harness([live(), live(), expired], ["approved"]));
    expect(response).toEqual({ status: 403, body: { error: "activation_closed" } });
    expect(handle).not.toHaveBeenCalled();
  });

  it("refuses a publish when the account is suspended before commit", async () => {
    const { response, handle } = await publishWith(harness([live(), live()], ["approved", "suspended"]));
    expect(response).toEqual(
      { status: 403, body: { error: "account_not_approved", status: "suspended" } });
    expect(handle).not.toHaveBeenCalled();
  });

  it("refuses a publish when the cohort no longer lists the publisher", async () => {
    const { response, handle } = await publishWith(harness([live(), live(), live(["bob"])], ["approved"]));
    expect(response).toEqual({ status: 403, body: { error: "not_in_cohort" } });
    expect(handle).not.toHaveBeenCalled();
  });

  it("refuses cohort removal while the final account query is pending", async () => {
    let subjects = ["alice"];
    let reads = 0;
    const authority: AdmissionAuthority = {
      readActivation: () => live(subjects), nowMs: () => NOW,
      readStatus: async () => {
        if (++reads === 2) subjects = ["bob"];
        return "approved";
      },
    };
    const { response, handle } = await publishWith(authority);
    expect(response).toEqual({ status: 403, body: { error: "not_in_cohort" } });
    expect(handle).not.toHaveBeenCalled();
  });

  it("refuses an expiration reached while the final account query is pending", async () => {
    let now = NOW;
    let reads = 0;
    const authority: AdmissionAuthority = {
      readActivation: () => live(),
      nowMs: () => now,
      readStatus: async () => {
        if (++reads === 2) now = FUTURE;
        return "approved";
      },
    };
    const { host, handle } = stubHost();
    const response = await createArtifactControl(host, "scope", "pages.example.test", authority)
      .handle("ensure", "alice", { bindingName: "summer", idempotencyKey: "key" });
    expect(response).toEqual({ status: 403, body: { error: "activation_closed" } });
    expect(handle).not.toHaveBeenCalled();
  });

  it("refuses at entry when the publisher is already suspended", async () => {
    const { response, handle } = await publishWith(harness([live()], ["suspended"]));
    expect(response).toEqual(
      { status: 403, body: { error: "account_not_approved", status: "suspended" } });
    expect(handle).not.toHaveBeenCalled();
  });

  it("refuses at entry when activation is already closed", async () => {
    const { response, handle } = await publishWith(harness([expired], ["approved"]));
    expect(response).toEqual({ status: 403, body: { error: "activation_closed" } });
    expect(handle).not.toHaveBeenCalled();
  });

  it("publishes with a complete receipt while admission holds", async () => {
    const { response, handle } = await publishWith(harness([live(), live()], ["approved", "approved"]));
    expect(response).toEqual({ status: 201,
      body: { artifactId: ARTIFACT, releaseId: RELEASE, digest: DIGEST,
        stableUrl: `https://${ARTIFACT}.pages.example.test/`,
        pinnedUrl: `https://${RELEASE}.pinned.pages.example.test/` } });
    expect(handle).toHaveBeenCalledTimes(1);
  });
});
