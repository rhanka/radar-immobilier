import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createLiveHostEndpoints, FAIL_CLOSED_HOST_BUILD_LEDGER, readLiveHostKeys, type HostBuildLedger } from "./live-host-endpoints.js";

class FakeLiveHostError extends Error { constructor(readonly code: string) { super(code); } }
const builder = generateKeyPairSync("ed25519");
const receipt = generateKeyPairSync("ed25519");
const der = (key: { export(options: object): Buffer }, type: "spki" | "pkcs8") => key.export({ format: "der", type }).toString("base64");
const keys = readLiveHostKeys({
  IMMO_ARTIFACTS_BUILDER_HANDOFF_PUBLIC_KEYS: `sentropic-builder-1=${der(builder.publicKey, "spki")}`,
  IMMO_ARTIFACTS_RECEIPT_SIGNING_KEY: der(receipt.privateKey, "pkcs8"), IMMO_ARTIFACTS_RECEIPT_KEY_ID: "immo-preprod-receipt-1" });
const claims = { artifactId: "a", jobId: "j", fence: { runId: "r", attempt: 1 } };
const module = {
  verifyJobRequest: vi.fn((body: { forged?: boolean }) => { if (body.forged) throw new FakeLiveHostError("request_invalid"); return claims; }),
  resolvePendingJob: vi.fn((view: { pending: boolean }) => view.pending
    ? { job: { jobId: "j", generation: 1, headSha: "h", expectedReleaseId: null }, fence: claims.fence } : null),
  parseHandoffRequest: vi.fn(() => ({ handoff: { claims }, files: [{ path: "index.html", bytes: new Uint8Array(1) }] })),
  acceptHandoff: vi.fn(async (options: { receiptKey: { kid: string } }) => ({ v: 1, kid: options.receiptKey.kid, releaseId: "rel" })),
  refusalOf: (error: unknown) => error instanceof FakeLiveHostError ? { v: 1, error: error.code } : undefined,
};
const ledger = (pending: boolean): HostBuildLedger & { admitted: unknown[] } => {
  const admitted: unknown[] = [];
  return { admitted, view: async () => ({ pending }), admitFence: async (...args) => { admitted.push(args); },
    ledger: { find: async () => undefined, transaction: async (_key, work) => work() },
    publish: async () => ({ releaseId: "rel", manifestDigest: "m", storedDigest: "s" }) };
};

describe("inbound SG4b host build API", () => {
  it("parses the Ed25519 builder keys and the receipt key", () => {
    expect(keys.builderKeys.get("sentropic-builder-1")?.asymmetricKeyType).toBe("ed25519");
    expect(keys.receiptKey?.kid).toBe("immo-preprod-receipt-1");
    expect(readLiveHostKeys({}).receiptKey).toBeUndefined();
    expect(() => readLiveHostKeys({ IMMO_ARTIFACTS_RECEIPT_KEY_ID: "k" })).toThrow("artifact_receipt_key_invalid");
    expect(() => readLiveHostKeys({ IMMO_ARTIFACTS_BUILDER_HANDOFF_PUBLIC_KEYS: "k=AAAA" })).toThrow("artifact_builder_handoff_keys_invalid");
  });

  it("answers 503 while the provider live-host subpath is absent (0.2.18)", async () => {
    const endpoints = createLiveHostEndpoints({ module: undefined, scopeId: "s", keys });
    expect(await endpoints.job({})).toEqual({ status: 503, body: { error: "capability_unavailable" } });
    expect((await endpoints.handoff({})).status).toBe(503);
  });

  it("resolves the pending job and admits the attempt fence", async () => {
    const store = ledger(true);
    const endpoints = createLiveHostEndpoints({ module, scopeId: "s", keys, ledger: store });
    expect(await endpoints.job({ claims: {} })).toEqual({ status: 200, body: { v: 1,
      job: { jobId: "j", generation: 1, headSha: "h", expectedReleaseId: null } } });
    expect(store.admitted).toEqual([["s", "a", "j", { runId: "r", attempt: 1 }]]);
    expect(module.verifyJobRequest).toHaveBeenCalledWith({ claims: {} }, expect.objectContaining({ scopeId: "s" }));
  });

  it("refuses a forged request and a job that is not pending with closed bodies", async () => {
    const endpoints = createLiveHostEndpoints({ module, scopeId: "s", keys, ledger: ledger(false) });
    expect(await endpoints.job({ forged: true })).toEqual({ status: 400, body: { v: 1, error: "request_invalid" } });
    expect(await endpoints.job({})).toEqual({ status: 409, body: { v: 1, error: "handoff_mismatch", reason: "job_not_pending" } });
  });

  it("accepts a handoff with immo's receipt key, and answers 503 without a ledger or a receipt key", async () => {
    const endpoints = createLiveHostEndpoints({ module, scopeId: "s", keys, ledger: ledger(true) });
    expect(await endpoints.handoff({ v: 1 })).toEqual({ status: 200, body: { v: 1,
      receipt: { v: 1, kid: "immo-preprod-receipt-1", releaseId: "rel" } } });
    const closed = createLiveHostEndpoints({ module: { ...module, acceptHandoff: async () => FAIL_CLOSED_HOST_BUILD_LEDGER.publish(null, []) },
      scopeId: "s", keys });
    expect((await closed.handoff({ v: 1 })).status).toBe(503);
    expect((await createLiveHostEndpoints({ module, scopeId: "s", keys: { builderKeys: keys.builderKeys } }).handoff({})).status).toBe(503);
    expect((await createLiveHostEndpoints({ module, scopeId: "s", keys }).job({})).status).toBe(503);
  });
});
