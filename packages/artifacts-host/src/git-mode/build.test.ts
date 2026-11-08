import { generateKeyPairSync } from "node:crypto";
import type { GitBinding } from "@sentropic/artifacts";
import { describe, expect, it, vi } from "vitest";
import { createMemoryGitBindingStore } from "@sentropic/artifacts";
import * as liveHost from "@sentropic/artifacts/live-host";
import {
  acceptHandoff, CANDIDATE_LIMITS, candidateDigest, encodeHandoffRequest, HANDOFF_LIFETIME_MS, LiveHostError, sealHandoff,
  verifyReceipt, type AcceptOptions, type CandidateFile, type HandoffClaims, type HandoffReceipt, type HostRecheckView,
} from "@sentropic/artifacts/live-host";
import { createHostBuildApiClient, createMemoryJobStore } from "./build-api.js";
import { composeGitMode, readGitModeConfig } from "./compose.js";
import type { GitBuildPort } from "./provider-adapter.js";
import { loadLiveHost } from "./live-host-adapter.js";
import { createLiveHostEndpoints, FAIL_CLOSED_HOST_BUILD_LEDGER, type HostBuildLedger } from "./live-host-endpoints.js";

/**
 * SG4b handoff, host side, run against the PROVIDER code (`@sentropic/artifacts/live-host`, 0.2.20): the cases of the
 * former immo contract reference (handoff.contract.test-support.ts, deleted with the pin) now assert that the
 * package's sealHandoff / acceptHandoff / candidateDigest / verifyReceipt enforce them. immo runs no crypto of its own.
 */
const MiB = 1024 * 1024;
const builder = { kid: "sentropic-builder-1", ...generateKeyPairSync("ed25519") };
const foreign = { kid: "sentropic-builder-1", ...generateKeyPairSync("ed25519") };
const host = { kid: "immo-preprod-receipt-1", ...generateKeyPairSync("ed25519") };
const NOW = Date.parse("2026-11-08T00:00:00.000Z");
const SHA = "b".repeat(40);
const IMAGE = "docker.io/sentropic/builder@sha256:" + "1".repeat(64);
const ARTIFACT = "11111111-1111-4111-8111-111111111111";
const binding: GitBinding = { artifactId: ARTIFACT, storageScopeId: "s", repoId: "radar-immobilier",
  branch: "artifact/p/alice000/triage-11111111", channel: "personal", personalPrincipalId: "alice", subPath: "",
  baseCommitSha: "a".repeat(40), headCommitSha: SHA, releaseCommitSha: null, autoPublish: true, executor: "sandbox",
  pendingJobId: "job-1", pendingCommitSha: SHA, state: "build_pending", generation: 2, version: 3, attachedBy: "alice",
  attachedAt: "2026-11-07T00:00:00.000Z", updatedAt: "2026-11-07T00:00:00.000Z" };
const index: CandidateFile[] = [{ path: "index.html", bytes: new TextEncoder().encode("<!doctype html>") }];

function seal(files: readonly CandidateFile[] = index, overrides: Partial<HandoffClaims> = {}, signer = builder) {
  return sealHandoff({ scopeId: "s", artifactId: ARTIFACT, jobId: "job-1", kind: "explicit", runId: "run-1", attempt: 1,
    generation: 2, commitSha: SHA, treeSha: "c".repeat(40), candidateDigest: candidateDigest(files), expectedReleaseId: null,
    tuple: { commitSha: SHA, treeSha: "c".repeat(40), lockfileDigest: "l", descriptorDigest: "d", builderImageDigest: IMAGE,
      nodeVersion: "22", npmVersion: "10", publicEnvHashes: {} }, ...overrides }, { kid: signer.kid, key: signer.privateKey }, NOW - 1000);
}
/** The locked host rows of a pending, owner-requested job (what host-ledger.ts `view` returns). */
function view(current: GitBinding = binding): HostRecheckView {
  return { scopeId: "s", killSwitch: false, imageAllowlist: [IMAGE], currentReleaseId: null, headReachable: true,
    binding: { artifactId: current.artifactId, state: current.state, generation: current.generation, executor: current.executor,
      autoPublish: current.autoPublish, pendingJobId: current.pendingJobId, pendingCommitSha: current.pendingCommitSha },
    job: { jobId: "job-1", state: "building", bindingGeneration: 2, commitSha: SHA, expectedCurrentReleaseId: null,
      fence: { runId: "run-1", attempt: 1 } },
    policy: { ownerAuthorized: true, automaticAuthorized: false, automaticEligible: false } };
}
function memoryHost(current: () => HostRecheckView = () => view(), now = NOW) {
  const receipts = new Map<string, HandoffReceipt>();
  const state = { releases: 0 };
  const options: AcceptOptions = { scopeId: "s", builderKeys: (kid) => kid === builder.kid ? builder.publicKey : undefined,
    receiptKey: { kid: host.kid, key: host.privateKey }, now: () => now,
    ledger: { find: async (key) => receipts.get(key),
      async transaction(key, work) {
        const stored = receipts.get(key);
        if (stored) return stored;
        const receipt = await work();
        receipts.set(key, receipt);
        return receipt;
      } },
    view: () => current(),
    async publish(_claims, files) { state.releases += 1; return { releaseId: `r-${state.releases}`, manifestDigest: "sha256:m",
      storedDigest: candidateDigest(files) }; } };
  return { options, state };
}
const refusal = async (promise: Promise<unknown>) => promise.then(() => "accepted",
  (error: unknown) => error instanceof LiveHostError ? [error.code, error.reason].filter(Boolean).join(":") : String(error));
const accept = (handoff = seal(), files: readonly CandidateFile[] = index, current?: () => HostRecheckView, now?: number) =>
  refusal(acceptHandoff(memoryHost(current, now).options, handoff, files));

describe("SG4b handoff verification (provider live-host, host side)", () => {
  it("is the pinned provider subpath", async () => {
    expect(await loadLiveHost()).toBe(liveHost);
    expect(HANDOFF_LIFETIME_MS).toBe(10 * 60 * 1000);
    expect(CANDIDATE_LIMITS).toEqual({ files: 255, fileBytes: 16 * MiB, totalBytes: 64 * MiB });
  });

  it("accepts a signed, live, single-job handoff and signs a receipt the builder verifies", async () => {
    const handoff = seal();
    const receipt = await acceptHandoff(memoryHost().options, handoff, index);
    expect(receipt).toMatchObject({ kid: host.kid, jobId: "job-1", releaseId: "r-1", candidateDigest: handoff.claims.candidateDigest });
    expect(() => verifyReceipt(receipt, (kid) => kid === host.kid ? host.publicKey : undefined, handoff.claims)).not.toThrow();
    expect(() => verifyReceipt({ ...receipt, releaseId: "r-9" }, () => host.publicKey, handoff.claims)).toThrow(LiveHostError);
  });

  it("refuses a bad signature, a foreign key and a tampered field", async () => {
    expect(await accept({ ...seal(), signature: "AAAA" })).toBe("handoff_unauthenticated");
    expect(await accept(seal(index, {}, foreign))).toBe("handoff_unauthenticated");
    const tampered = seal();
    expect(await accept({ ...tampered, claims: { ...tampered.claims, jobId: "job-2" } })).toBe("handoff_unauthenticated");
  });

  it("refuses an expired authorization (10-minute single-use lifetime)", async () => {
    expect(await accept(seal(), index, undefined, NOW - 1000 + HANDOFF_LIFETIME_MS)).toBe("handoff_expired");
    expect(await accept(seal(), index, undefined, NOW - 1000 + HANDOFF_LIFETIME_MS - 1)).toBe("accepted");
  });

  it("refuses a handoff for another job, commit or generation of the binding", async () => {
    expect(await accept(seal(), index, () => view({ ...binding, pendingJobId: "job-9" }))).toBe("handoff_mismatch:job_not_pending");
    expect(await accept(seal(), index, () => view({ ...binding, pendingCommitSha: "d".repeat(40) })))
      .toBe("handoff_mismatch:job_not_pending");
    expect(await accept(seal(), index, () => view({ ...binding, generation: 3 }))).toBe("handoff_mismatch:generation_mismatch");
    expect(await accept(seal(), index, () => ({ ...view(), imageAllowlist: [] }))).toBe("handoff_mismatch:image_not_allowed");
    expect(await accept(seal(), index, () => ({ ...view(), killSwitch: true }))).toBe("handoff_mismatch:publication_paused");
  });

  it("enforces 255 files, 16 MiB per file and 64 MiB per release at the exact boundaries", () => {
    const shared = new Uint8Array(16 * MiB);
    const many = (count: number, bytes = new Uint8Array(1)) => Array.from({ length: count }, (_, i) => ({ path: `f${i}.js`, bytes }));
    const digest = (files: CandidateFile[]) => { try { candidateDigest(files); return "accepted"; }
      catch (error) { return (error as LiveHostError).code; } };
    expect(digest(many(255))).toBe("accepted");
    expect(digest(many(256))).toBe("candidate_invalid");
    expect(digest([{ path: "a.png", bytes: shared }])).toBe("accepted");
    expect(digest([{ path: "a.png", bytes: new Uint8Array(16 * MiB + 1) }])).toBe("candidate_invalid");
    expect(digest(many(4, shared))).toBe("accepted");
    expect(digest([...many(4, shared), { path: "x.css", bytes: new Uint8Array(1) }])).toBe("candidate_invalid");
  });

  it("refuses candidate bytes that the sealed digest does not cover", async () => {
    expect(await accept(seal(), [{ path: "index.html", bytes: new TextEncoder().encode("<!doctype html>!") }]))
      .toBe("candidate_bytes_mismatch");
  });
});

describe("SG4b acceptance and signed host receipt (provider acceptHandoff)", () => {
  it("commits once and replays the same signed receipt for the same authorization", async () => {
    const memory = memoryHost();
    const first = await acceptHandoff(memory.options, seal(), index);
    const second = await acceptHandoff(memory.options, seal(), index);
    expect(second).toEqual(first);
    expect(memory.state.releases).toBe(1);
    const other = seal(index, { attempt: 2, runId: "run-2" });
    expect(await refusal(acceptHandoff(memory.options, other, index))).toBe("handoff_replayed");
  });

  it("fails closed without a durable ledger (503, nothing decoded or published)", async () => {
    const keys = { builderKeys: new Map([[builder.kid, builder.publicKey]]), receiptKey: { kid: host.kid, key: host.privateKey } };
    const endpoints = createLiveHostEndpoints({ module: liveHost, scopeId: "s", keys, now: () => NOW });
    expect(await endpoints.handoff(encodeHandoffRequest(seal(), index))).toEqual({ status: 503, body: { error: "capability_unavailable" } });
    await expect(FAIL_CLOSED_HOST_BUILD_LEDGER.view(seal().claims)).rejects.toMatchObject({ kind: "provider_unavailable" });
  });

  it("authenticates the handoff before decoding any candidate file (review 1030-r2 m3)", async () => {
    const keys = { builderKeys: new Map([[builder.kid, builder.publicKey]]), receiptKey: { kid: host.kid, key: host.privateKey } };
    const memory = memoryHost();
    const ledger: HostBuildLedger = { admitJob: async () => null, ledger: memory.options.ledger,
      view: async (claims) => memory.options.view(claims), publish: (claims, files) => memory.options.publish(claims, files) };
    const parseHandoffRequest = vi.fn(liveHost.parseHandoffRequest);
    const endpoints = createLiveHostEndpoints({ module: { ...liveHost, parseHandoffRequest }, scopeId: "s", keys, ledger, now: () => NOW });
    const big = [{ path: "big.bin", bytes: new Uint8Array(8 * MiB) }];
    const forged = encodeHandoffRequest({ ...seal(big), signature: "AAAA" }, big);
    expect(await endpoints.handoff(forged)).toEqual({ status: 401, body: { v: 1, error: "handoff_unauthenticated" } });
    expect(await endpoints.handoff(encodeHandoffRequest(seal(big, {}, foreign), big)))
      .toEqual({ status: 401, body: { v: 1, error: "handoff_unauthenticated" } });
    expect(parseHandoffRequest).not.toHaveBeenCalled();
    expect(await endpoints.handoff({ v: 1, handoff: seal(), files: "x" })).toEqual({ status: 400, body: { v: 1, error: "request_invalid" } });
    expect(await endpoints.handoff({ v: 2 })).toEqual({ status: 400, body: { v: 1, error: "request_invalid" } });
    const accepted = await endpoints.handoff(encodeHandoffRequest(seal(), index));
    expect(accepted).toMatchObject({ status: 200, body: { v: 1, receipt: { kid: host.kid, releaseId: "r-1" } } });
    expect(memory.state.releases).toBe(1);
  });
});

describe("host build API client (W7)", () => {
  const job = { storageScopeId: "s", artifactId: binding.artifactId, repoId: "radar-immobilier", branch: binding.branch,
    subPath: "", commitSha: SHA, bindingGeneration: 2, expectedCurrentReleaseId: null, executor: "sandbox" as const,
    requestedBy: "alice", idempotencyKey: "k" };
  const identity = { authorization: async () => "Bearer service-token" };
  const BASE = "https://builder.example/api/v1/artifacts/builder";
  const bindings = { get: vi.fn(async () => binding) };

  it("admits only the sandbox executor, and only when the builder is configured", async () => {
    expect(await createHostBuildApiClient({}).admits("sandbox")).toBe(false);
    const client = createHostBuildApiClient({ baseUrl: BASE, identity });
    expect(await client.admits("sandbox")).toBe(true);
    expect(await client.admits("caller")).toBe(false);
    expect(await client.admits("ci")).toBe(false);
  });

  it("persists the job, then posts exactly { artifactId, jobId, binding } to /v1/builds (202 or 200)", async () => {
    const jobs = createMemoryJobStore();
    const fetcher = vi.fn(async (_url: URL, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { jobId: string };
      return new Response(JSON.stringify({ jobId: body.jobId, state: "build_pending" }), { status: 202 });
    });
    const client = createHostBuildApiClient({ baseUrl: BASE, identity, jobs, bindings, fetch: fetcher as never });
    const first = await client.request(job);
    expect(first.state).toBe("build_pending");
    const [url, init] = fetcher.mock.calls[0]! as unknown as [URL, RequestInit];
    expect(String(url)).toBe(`${BASE}/v1/builds`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ artifactId: job.artifactId, jobId: first.jobId,
      binding: { repoId: "radar-immobilier", branch: binding.branch, subPath: "" } });
    expect(Object.keys(JSON.parse(String(init.body))).sort()).toEqual(["artifactId", "binding", "jobId"]);
    expect(Object.keys(JSON.parse(String(init.body)).binding).sort()).toEqual(["branch", "repoId", "subPath"]);
    expect(bindings.get).toHaveBeenCalledWith("s", job.artifactId);
    expect(String(init.body).length).toBeLessThanOrEqual(2048);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer service-token");
    expect(jobs.jobs.get(first.jobId)).toEqual(job);
    expect((await client.request(job)).jobId).toBe(first.jobId);
  });

  it("takes the binding coordinates from the store record, never from the job fields", async () => {
    const fetcher = vi.fn(async (_url: URL, init: RequestInit) => new Response(JSON.stringify({
      jobId: (JSON.parse(String(init.body)) as { jobId: string }).jobId, state: "build_pending" }), { status: 202 }));
    const stored = { ...binding, repoId: "stored-repo", branch: "artifact/p/alice000/other-22222222", subPath: "sub/dir" };
    const client = createHostBuildApiClient({ baseUrl: BASE, identity, jobs: createMemoryJobStore(), bindings: { get: async () => stored },
      fetch: fetcher as never });
    await client.request({ ...job, repoId: "forged", branch: "artifact/forged", subPath: "forged" });
    expect(JSON.parse(String((fetcher.mock.calls[0] as unknown as [URL, RequestInit])[1].body)).binding)
      .toEqual({ repoId: "stored-repo", branch: "artifact/p/alice000/other-22222222", subPath: "sub/dir" });
  });

  it("fails closed with git_not_attached before any builder call or job persistence without the binding of THAT generation", async () => {
    for (const record of [undefined, { ...binding, state: "detached" as const }, { ...binding, generation: 3 }, { ...binding, generation: 1 }]) {
      const fetcher = vi.fn();
      const jobs = createMemoryJobStore();
      const client = createHostBuildApiClient({ baseUrl: BASE, identity, jobs, bindings: { get: async () => record }, fetch: fetcher as never });
      await expect(client.request(job)).rejects.toMatchObject({ kind: "git_not_attached" });
      expect(fetcher).not.toHaveBeenCalled();
      expect(jobs.jobs.size).toBe(0);
    }
    const fetcher = vi.fn();
    await expect(createHostBuildApiClient({ baseUrl: BASE, identity, jobs: createMemoryJobStore(), fetch: fetcher as never }).request(job))
      .rejects.toMatchObject({ kind: "provider_unavailable" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reads a build status from /v1/builds/<artifactId>/<jobId>", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ jobId: "j1", state: "published", releaseId: "r1" }), { status: 200 }));
    const client = createHostBuildApiClient({ baseUrl: BASE, identity, fetch: fetcher as never });
    await expect(client.status(job.artifactId, "j1")).resolves.toEqual({ jobId: "j1", state: "published", releaseId: "r1" });
    expect(String((fetcher.mock.calls[0] as unknown as [URL])[0])).toBe(`${BASE}/v1/builds/${job.artifactId}/j1`);
  });

  it("fails closed on builder errors, malformed answers and a missing job store", async () => {
    for (const answer of [new Response("{}", { status: 503 }), new Response(JSON.stringify({ jobId: "x", state: "weird" }), { status: 202 })]) {
      const client = createHostBuildApiClient({ baseUrl: BASE, identity, jobs: createMemoryJobStore(), bindings, fetch: (async () => answer) as never });
      await expect(client.request(job)).rejects.toMatchObject({ kind: "provider_unavailable" });
    }
    await expect(createHostBuildApiClient({ baseUrl: BASE, identity }).request(job)).rejects.toMatchObject({ kind: "provider_unavailable" });
    await expect(createHostBuildApiClient({}).request(job)).rejects.toMatchObject({ kind: "provider_unavailable" });
    expect(() => createHostBuildApiClient({ baseUrl: "http://builder.example", identity })).toThrow("artifact_git_builder_url_invalid");
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
  it("hands git_publish a build port that stays closed until the builder URL is configured", async () => {
    expect(await compose({}).admits("sandbox")).toBe(false);
    const configured = compose({ IMMO_ARTIFACTS_BUILDER_URL: "https://preprod.sentropic.sent-tech.ca/api/v1/artifacts/builder" });
    expect(await configured.admits("sandbox")).toBe(true);
    for (const executor of ["caller", "ci"] as const) expect(await configured.admits(executor)).toBe(false);
  });
});
