import { generateKeyPairSync, sign, verify } from "node:crypto";
import type { GitBinding } from "@sentropic/artifacts";
import { describe, expect, it, vi } from "vitest";
import { createMemoryGitBindingStore } from "@sentropic/artifacts";
import { createHostBuildApiClient } from "./build-api.js";
import { composeGitMode, readGitModeConfig } from "./compose.js";
import type { GitBuildPort } from "./provider-adapter.js";
import {
  createHandoffAcceptance, HANDOFF_MAX_LIFETIME_MS, type BuildHandoff, type HandoffCommitPort, type HandoffManifestFile,
  type HostReceipt,
} from "./handoff.js";
import { candidateDigestOf, canonicalJson, verifyBuildHandoff } from "./handoff.contract.test-support.js";
import { loadLiveHost } from "./live-host-adapter.js";

const MiB = 1024 * 1024;
const builder = generateKeyPairSync("ed25519");
const host = generateKeyPairSync("ed25519");
const NOW = Date.parse("2026-11-08T00:00:00.000Z");
const SHA = "b".repeat(40);
const binding: GitBinding = { artifactId: "11111111-1111-4111-8111-111111111111", storageScopeId: "s", repoId: "radar-immobilier",
  branch: "artifact/p/alice000/triage-11111111", channel: "personal", personalPrincipalId: "alice", subPath: "",
  baseCommitSha: "a".repeat(40), headCommitSha: SHA, releaseCommitSha: null, autoPublish: true, executor: "sandbox",
  pendingJobId: "job-1", pendingCommitSha: SHA, state: "build_pending", generation: 2, version: 3, attachedBy: "alice",
  attachedAt: "2026-11-07T00:00:00.000Z", updatedAt: "2026-11-07T00:00:00.000Z" };

function handoff(files: HandoffManifestFile[] = [{ path: "index.html", mimeType: "text/html", size: 10, digest: "sha256:x" }],
  overrides: Partial<Omit<BuildHandoff, "signature">> = {}, key = builder.privateKey): BuildHandoff {
  const candidateDigest = candidateDigestOf(files);
  const unsigned = { authorizationId: "auth-1", jobId: "job-1", storageScopeId: "s", artifactId: binding.artifactId,
    bindingGeneration: 2, issuedAt: new Date(NOW - 1000).toISOString(), expiresAt: new Date(NOW + 9 * 60 * 1000).toISOString(),
    candidateDigest, manifest: { files },
    receipt: { candidateDigest, jobId: "job-1", releaseId: "r-1", manifestDigest: "sha256:m", executor: "sandbox" as const,
      verification: "builder-attested" as const, producer: { runId: "run-1", attempt: 1 },
      tuple: { commitSha: SHA, treeSha: "c".repeat(40), lockfileDigest: "l", descriptorDigest: "d", builderImageDigest: "i",
        nodeVersion: "22", npmVersion: "10", publicEnvHashes: {} } },
    ...overrides };
  return { ...unsigned, signature: sign(null, Buffer.from(canonicalJson(unsigned)), key).toString("base64") };
}
const check = (input: unknown, current: GitBinding | undefined = binding, now = NOW) =>
  verifyBuildHandoff(input, { builderPublicKey: builder.publicKey, binding: current, now });
const detail = (fn: () => unknown) => {
  try { fn(); } catch (error) { return (error as { details?: { publicDetails?: { handoff?: string } } }).details?.publicDetails?.handoff; }
  return "accepted";
};

describe("SG4b handoff verification (host side)", () => {
  it("accepts a signed, live, single-job handoff within the release ceilings", () => {
    expect(check(handoff()).handoff.jobId).toBe("job-1");
  });

  it("refuses a bad signature, a foreign key and a tampered field", () => {
    expect(detail(() => check({ ...handoff(), signature: "AAAA" }))).toBe("signature");
    expect(detail(() => check(handoff(undefined, {}, host.privateKey)))).toBe("signature");
    expect(detail(() => check({ ...handoff(), jobId: "job-2" }))).toBe("signature");
  });

  it("refuses a lifetime above 10 minutes and an expired authorization", () => {
    expect(detail(() => check(handoff(undefined, { expiresAt: new Date(NOW - 1000 + HANDOFF_MAX_LIFETIME_MS + 1).toISOString() }))))
      .toBe("lifetime");
    expect(detail(() => check(handoff(), binding, NOW + 9 * 60 * 1000))).toBe("expired");
  });

  it("refuses a handoff for another job, commit or generation of the binding", () => {
    expect(detail(() => check(handoff(), { ...binding, pendingJobId: "job-9" }))).toBe("job");
    expect(detail(() => check(handoff(), { ...binding, pendingCommitSha: "d".repeat(40) }))).toBe("job");
    expect(detail(() => check(handoff(), { ...binding, generation: 3 }))).toBe("job");
    expect(detail(() => verifyBuildHandoff(handoff(), { builderPublicKey: builder.publicKey, binding: undefined, now: NOW })))
      .toBe("job");
  });

  it("enforces 255 files, 16 MiB per file and 64 MiB per release at the exact boundaries", () => {
    const many = (count: number, size = 1) => Array.from({ length: count }, (_, i) => ({ path: `f${i}.js`, mimeType: "text/javascript", size, digest: `d${i}` }));
    expect(detail(() => check(handoff(many(255))))).toBe("accepted");
    expect(detail(() => check(handoff(many(256))))).toBe("file_count");
    expect(detail(() => check(handoff([{ path: "a.png", mimeType: "image/png", size: 16 * MiB, digest: "a" }])))).toBe("accepted");
    expect(detail(() => check(handoff([{ path: "a.png", mimeType: "image/png", size: 16 * MiB + 1, digest: "a" }])))).toBe("file_bytes");
    expect(detail(() => check(handoff(many(4, 16 * MiB))))).toBe("accepted");
    expect(detail(() => check(handoff([...many(4, 16 * MiB), { path: "x", mimeType: "text/css", size: 1, digest: "x" }]))))
      .toBe("release_bytes");
  });

  it("refuses a candidate digest that does not cover the manifest", () => {
    const files = [{ path: "index.html", mimeType: "text/html", size: 10, digest: "sha256:x" }];
    const forged = handoff(files, { manifest: { files: [{ ...files[0]!, size: 11 }] } });
    expect(detail(() => check(forged))).toBe("candidate_digest");
  });
});

describe("SG4b acceptance and signed host receipt", () => {
  function memoryCommit(): HandoffCommitPort & { releases: number } {
    const receipts = new Map<string, HostReceipt>();
    const port = { releases: 0, async commit({ handoff: h }: Parameters<HandoffCommitPort["commit"]>[0]) {
      const existing = receipts.get(h.authorizationId);
      if (existing) return { receipt: existing, replayed: true };
      port.releases += 1;
      const receipt = { authorizationId: h.authorizationId, jobId: h.jobId, releaseId: h.receipt.releaseId,
        candidateDigest: h.candidateDigest, committedAt: new Date(NOW).toISOString() };
      receipts.set(h.authorizationId, receipt);
      return { receipt, replayed: false };
    } };
    return port;
  }

  // Stand-ins for the provider live-host verifier and receipt signer (0.2.20).
  const ports = {
    verify: (input: unknown, context: { binding: GitBinding | undefined; now: number }) =>
      verifyBuildHandoff(input, { ...context, builderPublicKey: builder.publicKey }),
    signReceipt: (receipt: HostReceipt) => sign(null, Buffer.from(canonicalJson(receipt)), host.privateKey).toString("base64"),
  };

  it("commits once, signs the receipt and replays the same receipt for the same authorization", async () => {
    const commit = memoryCommit();
    const acceptance = createHandoffAcceptance({ ...ports, binding: async () => binding, commit, now: () => NOW });
    const first = await acceptance.accept(handoff());
    const second = await acceptance.accept(handoff());
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.receipt).toEqual(first.receipt);
    expect(commit.releases).toBe(1);
    expect(verify(null, Buffer.from(canonicalJson(first.receipt)), host.publicKey, Buffer.from(first.signature, "base64"))).toBe(true);
  });

  it("fails closed without a durable commit port", async () => {
    const acceptance = createHandoffAcceptance({ ...ports, binding: async () => binding, now: () => NOW });
    await expect(acceptance.accept(handoff())).rejects.toMatchObject({ kind: "provider_unavailable" });
  });

  it("fails closed without the provider live-host verifier and signer (0.2.18)", async () => {
    expect(await loadLiveHost()).toBeUndefined();
    const commit = memoryCommit();
    await expect(createHandoffAcceptance({ binding: async () => binding, commit, now: () => NOW }).accept(handoff()))
      .rejects.toMatchObject({ kind: "provider_unavailable" });
    await expect(createHandoffAcceptance({ verify: ports.verify, binding: async () => binding, commit, now: () => NOW })
      .accept(handoff())).rejects.toMatchObject({ kind: "provider_unavailable" });
    expect(commit.releases).toBe(0);
  });
});

describe("host build API client", () => {
  const job = { storageScopeId: "s", artifactId: binding.artifactId, repoId: "radar-immobilier", branch: binding.branch,
    subPath: "", commitSha: SHA, bindingGeneration: 2, expectedCurrentReleaseId: null, executor: "sandbox" as const,
    requestedBy: "alice", idempotencyKey: "k" };

  it("admits only the sandbox executor, and only when the builder is configured", async () => {
    expect(await createHostBuildApiClient({}).admits("sandbox")).toBe(false);
    const client = createHostBuildApiClient({ origin: "https://builder.example", identity: { authorization: async () => "Bearer b" } });
    expect(await client.admits("sandbox")).toBe(true);
    expect(await client.admits("caller")).toBe(false);
    expect(await client.admits("ci")).toBe(false);
  });

  it("posts the persisted job identity and returns the builder job", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ jobId: "job-1", state: "build_pending" }), { status: 201 }));
    const client = createHostBuildApiClient({ origin: "https://builder.example", fetch: fetcher as never,
      identity: { authorization: async () => "Bearer b" } });
    await expect(client.request(job)).resolves.toEqual({ jobId: "job-1", state: "build_pending" });
    const [url, init] = fetcher.mock.calls[0]! as unknown as [URL, RequestInit];
    expect(String(url)).toBe("https://builder.example/artifacts/builder/v1/jobs");
    expect(JSON.parse(String(init.body))).toEqual(job);
  });

  it("fails closed on builder errors and malformed answers", async () => {
    for (const answer of [new Response("{}", { status: 503 }), new Response(JSON.stringify({ jobId: "j", state: "weird" }))]) {
      const client = createHostBuildApiClient({ origin: "https://builder.example", fetch: (async () => answer) as never,
        identity: { authorization: async () => "Bearer b" } });
      await expect(client.request(job)).rejects.toMatchObject({ kind: "provider_unavailable" });
    }
    await expect(createHostBuildApiClient({}).request(job)).rejects.toMatchObject({ kind: "provider_unavailable" });
  });
});

describe("build stage composition", () => {
  const resolution = { stage: "build", tools: ["artifacts_git_attach", "artifacts_fetch_app_source", "artifacts_git_publish"],
    unrouted: [] } as const;
  const compose = (env: NodeJS.ProcessEnv) => {
    let build: GitBuildPort | undefined;
    composeGitMode({ resolution, pool: { query: async () => ({ rows: [] }) } as never, storageScopeId: "s",
      config: readGitModeConfig(env), ports: { bindings: createMemoryGitBindingStore(),
        gitToolFactory: (deps) => { build = deps.build; return { execute: async () => ({}) }; } } });
    return build!;
  };
  it("hands git_publish a build port that stays closed until the builder is configured", async () => {
    expect(await compose({}).admits("sandbox")).toBe(false);
    const configured = compose({ IMMO_ARTIFACTS_BUILDER_ORIGIN: "https://builder.example", IMMO_ARTIFACTS_BUILDER_TOKEN: "t" });
    expect(await configured.admits("sandbox")).toBe(true);
    for (const executor of ["caller", "ci"] as const) expect(await configured.admits(executor)).toBe(false);
  });
});
