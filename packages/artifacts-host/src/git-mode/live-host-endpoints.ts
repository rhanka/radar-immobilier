import { createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";
import { ArtifactOperationError } from "@sentropic/artifacts/server/outcome-contract";
import type { LiveHostModule } from "./live-host-adapter.js";

/**
 * Inbound SG4b host build API (builder -> immo), W7 contract:
 * `POST <host base>/live-host/v1/job` then `POST <host base>/live-host/v1/handoff`
 * (`HOST_BUILD_PATHS` of `@sentropic/artifacts/live-host`). Mounted by
 * radar-api under `/api/v1/artifacts` (preprod host base
 * https://preprod.immo.sent-tech.ca/api/v1/artifacts), only when the git mode
 * stage selects `artifacts_git_publish`.
 *
 * - job: `verifyJobRequest` (Ed25519 builder key by kid, fresh, this scope),
 *   then `resolvePendingJob` on the locked host rows; answers `{ v: 1, job }`.
 * - handoff: `parseHandoffRequest`, then `acceptHandoff` (authentication,
 *   evidence, replay, recheck, publish in ONE host transaction, receipt signed
 *   with immo's Ed25519 receipt key); answers `{ v: 1, receipt }`.
 * Refusals are the package's closed `{ v: 1, error, reason? }` bodies; any
 * other failure is a 503 without detail. All verification code comes from the
 * provider (no immo crypto).
 *
 * Keys (immo-owned env, formats in docs/operator/git-artifact-mode.md):
 * IMMO_ARTIFACTS_BUILDER_HANDOFF_PUBLIC_KEYS (`kid=base64(SPKI DER)`, Ed25519,
 * several during a rotation), IMMO_ARTIFACTS_RECEIPT_SIGNING_KEY (base64
 * PKCS#8 DER, Ed25519) and IMMO_ARTIFACTS_RECEIPT_KEY_ID.
 */
export const HOST_BUILD_PATHS = Object.freeze({ job: "/live-host/v1/job", handoff: "/live-host/v1/handoff" });
export const HOST_JOB_BODY_MAX_BYTES = 8 * 1024;
/** 64 MiB of candidate bytes in base64 plus the JSON envelope. */
export const HOST_HANDOFF_BODY_MAX_BYTES = 96 * 1024 * 1024;

export interface LiveHostKeys {
  readonly builderKeys: ReadonlyMap<string, KeyObject>;
  readonly receiptKey?: { readonly kid: string; readonly key: KeyObject } | undefined;
}

const KID = /^[A-Za-z0-9._:-]{1,128}$/;

export function readLiveHostKeys(env: NodeJS.ProcessEnv): LiveHostKeys {
  const builderKeys = new Map<string, KeyObject>();
  for (const entry of (env.IMMO_ARTIFACTS_BUILDER_HANDOFF_PUBLIC_KEYS ?? "").split(",").map((part) => part.trim()).filter(Boolean)) {
    const separator = entry.indexOf("=");
    const kid = entry.slice(0, separator);
    let key: KeyObject;
    try { key = createPublicKey({ key: Buffer.from(entry.slice(separator + 1), "base64"), format: "der", type: "spki" }); }
    catch { throw new Error("artifact_builder_handoff_keys_invalid"); }
    if (separator < 1 || !KID.test(kid) || builderKeys.has(kid) || key.asymmetricKeyType !== "ed25519") {
      throw new Error("artifact_builder_handoff_keys_invalid");
    }
    builderKeys.set(kid, key);
  }
  const raw = env.IMMO_ARTIFACTS_RECEIPT_SIGNING_KEY?.trim();
  const kid = env.IMMO_ARTIFACTS_RECEIPT_KEY_ID?.trim();
  if (!raw && !kid) return { builderKeys };
  if (!raw || !kid || !KID.test(kid)) throw new Error("artifact_receipt_key_invalid");
  let key: KeyObject;
  try { key = createPrivateKey({ key: Buffer.from(raw, "base64"), format: "der", type: "pkcs8" }); }
  catch { throw new Error("artifact_receipt_key_invalid"); }
  if (key.asymmetricKeyType !== "ed25519") throw new Error("artifact_receipt_key_invalid");
  return { builderKeys, receiptKey: { kid, key } };
}

/**
 * Host job and publication ledger: the locked binding/job rows, the attempt
 * fence, the receipt ledger (find/transaction by job key) and the publish step
 * (store bytes, write release + git release index + receipt + baseline,
 * re-read). TODO(M3-I durable ledger): Postgres implementation; until then
 * every builder call answers 503.
 */
export interface HostBuildLedger {
  view(scopeId: string, artifactId: string, jobId: string): Promise<unknown>;
  admitFence(scopeId: string, artifactId: string, jobId: string, fence: { runId: string; attempt: number }): Promise<void>;
  readonly ledger: { find(jobKey: string): Promise<unknown>; transaction(jobKey: string, work: () => Promise<unknown>): Promise<unknown> };
  publish(claims: unknown, files: readonly unknown[]): Promise<{ releaseId: string; manifestDigest: string; storedDigest: string }>;
}

const closed = (): never => { throw new ArtifactOperationError("provider_unavailable"); };
export const FAIL_CLOSED_HOST_BUILD_LEDGER: HostBuildLedger = Object.freeze({
  view: async () => closed(), admitFence: async () => closed(),
  ledger: Object.freeze({ find: async () => closed(), transaction: async () => closed() }),
  publish: async () => closed(),
});

export interface HostEndpointResponse { readonly status: number; readonly body: unknown }

type Fn = (...args: never[]) => unknown;
const fn = (module: LiveHostModule | undefined, name: string) => {
  const value = (module as Record<string, unknown> | undefined)?.[name];
  return typeof value === "function" ? value as Fn : undefined;
};

const REFUSAL_STATUS: Readonly<Record<string, number>> = Object.freeze({
  request_invalid: 400, handoff_unauthenticated: 401, handoff_expired: 410, handoff_mismatch: 409, handoff_replayed: 409,
  handoff_evidence_missing: 422, candidate_invalid: 422, candidate_bytes_mismatch: 422, receipt_invalid: 422,
});
const UNAVAILABLE: HostEndpointResponse = Object.freeze({ status: 503, body: Object.freeze({ error: "capability_unavailable" }) });

export function createLiveHostEndpoints(input: {
  readonly module: LiveHostModule | undefined;
  readonly scopeId: string;
  readonly keys: LiveHostKeys;
  readonly ledger?: HostBuildLedger;
  readonly now?: () => number;
}) {
  const ledger = input.ledger ?? FAIL_CLOSED_HOST_BUILD_LEDGER;
  const now = input.now ?? Date.now;
  const builderKeys = (kid: string) => input.keys.builderKeys.get(kid);
  const verifyJobRequest = fn(input.module, "verifyJobRequest");
  const resolvePendingJob = fn(input.module, "resolvePendingJob");
  const parseHandoffRequest = fn(input.module, "parseHandoffRequest");
  const acceptHandoff = fn(input.module, "acceptHandoff");
  const refusalOf = fn(input.module, "refusalOf");
  const refusal = (error: unknown): HostEndpointResponse => {
    const body = refusalOf?.(error as never) as { error?: string } | undefined;
    return body?.error ? { status: REFUSAL_STATUS[body.error] ?? 422, body } : UNAVAILABLE;
  };
  return {
    async job(body: unknown): Promise<HostEndpointResponse> {
      if (!verifyJobRequest || !resolvePendingJob || !refusalOf) return UNAVAILABLE;
      try {
        const claims = verifyJobRequest(body as never, { scopeId: input.scopeId, builderKeys, now: now() } as never) as {
          artifactId: string; jobId: string; fence: { runId: string; attempt: number } };
        const view = await ledger.view(input.scopeId, claims.artifactId, claims.jobId);
        const resolved = resolvePendingJob(view as never, claims.jobId as never, claims.fence as never) as
          { job: unknown; fence: { runId: string; attempt: number } } | null;
        if (!resolved) return { status: 409, body: { v: 1, error: "handoff_mismatch", reason: "job_not_pending" } };
        await ledger.admitFence(input.scopeId, claims.artifactId, claims.jobId, resolved.fence);
        return { status: 200, body: { v: 1, job: resolved.job } };
      } catch (error) { return refusal(error); }
    },
    async handoff(body: unknown): Promise<HostEndpointResponse> {
      if (!parseHandoffRequest || !acceptHandoff || !refusalOf || !input.keys.receiptKey) return UNAVAILABLE;
      try {
        const { handoff, files } = parseHandoffRequest(body as never) as { handoff: { claims: { artifactId: string; jobId: string } };
          files: unknown[] };
        const receipt = await acceptHandoff({ scopeId: input.scopeId, builderKeys, receiptKey: input.keys.receiptKey, now,
          ledger: ledger.ledger,
          view: (claims: { artifactId: string; jobId: string }) => ledger.view(input.scopeId, claims.artifactId, claims.jobId),
          publish: (claims: unknown, candidate: readonly unknown[]) => ledger.publish(claims, candidate) } as never,
        handoff as never, files as never);
        return { status: 200, body: { v: 1, receipt } };
      } catch (error) { return refusal(error); }
    },
  };
}
export type LiveHostEndpoints = ReturnType<typeof createLiveHostEndpoints>;
