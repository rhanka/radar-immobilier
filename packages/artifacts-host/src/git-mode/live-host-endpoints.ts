import { createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";
import { ArtifactOperationError } from "@sentropic/artifacts/server/outcome-contract";
import type { LiveHostModule } from "./live-host-adapter.js";
import type {
  AcceptOptions, AttemptFence, CandidateFile, HandoffClaims, HostJob, HostLedger, HostRecheckView,
} from "@sentropic/artifacts/live-host";

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
 * - handoff: the builder signature and the evidence are authenticated FIRST,
 *   before any candidate file is decoded (review 1030-r2 m3): the provider
 *   exports no standalone handoff verifier, so `acceptHandoff` runs once on
 *   a probe ledger that stops at its first ledger read (which the package
 *   performs only after authentication, and before it touches the bytes).
 *   Then `parseHandoffRequest` decodes the files and `acceptHandoff` runs
 *   for real (replay, recheck, publish in ONE host transaction, receipt
 *   signed with immo's Ed25519 receipt key); answers `{ v: 1, receipt }`.
 * Refusals are the package's closed `{ v: 1, error, reason? }` bodies; any
 * other failure is a 503 without detail. All verification code comes from the
 * provider (no immo crypto).
 *
 * Keys (immo-owned env, formats in docs/operator/git-artifact-mode.md):
 * IMMO_ARTIFACTS_BUILDER_HANDOFF_PUBLIC_KEYS (`kid=base64(SPKI DER)`, Ed25519,
 * several during a rotation), IMMO_ARTIFACTS_RECEIPT_SIGNING_KEY (base64
 * PKCS#8 DER, Ed25519) and IMMO_ARTIFACTS_RECEIPT_KEY_ID.
 */
export { HOST_BUILD_PATHS } from "@sentropic/artifacts/live-host";
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
 * Host job and publication ledger (host-ledger.ts, Postgres): job admission
 * with the attempt fence, the receipt ledger (find/transaction by job key) and
 * the AcceptOptions `view`/`publish` steps, all inside the ledger transaction.
 * Without a ledger every builder call answers 503.
 */
export interface HostBuildLedger {
  admitJob(artifactId: string, jobId: string,
    decide: (view: HostRecheckView) => { job: HostJob; fence: AttemptFence } | null): Promise<HostJob | null>;
  readonly ledger: HostLedger;
  view(claims: HandoffClaims): Promise<HostRecheckView>;
  publish(claims: HandoffClaims, files: readonly CandidateFile[]): ReturnType<AcceptOptions["publish"]>;
}

const closed = (): never => { throw new ArtifactOperationError("provider_unavailable"); };
export const FAIL_CLOSED_HOST_BUILD_LEDGER: HostBuildLedger = Object.freeze({
  admitJob: async () => closed(),
  ledger: Object.freeze({ find: async () => closed(), transaction: async () => closed() }),
  view: async () => closed(), publish: async () => closed(),
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
const HOST_REFUSAL_REASON: Readonly<Record<string, string>> = Object.freeze({
  pointer_conflict: "release_conflict", gone: "policy_refused", not_found: "job_not_pending",
});
/** Thrown by the probe ledger: the handoff passed authentication and evidence. */
const AUTHENTICATED = Object.freeze(new Error("handoff_authenticated_probe"));
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const UNAVAILABLE: HostEndpointResponse = Object.freeze({ status: 503, body: Object.freeze({ error: "capability_unavailable" }) });

export function createLiveHostEndpoints(input: {
  readonly module: LiveHostModule | undefined;
  readonly scopeId: string;
  readonly keys: LiveHostKeys;
  readonly ledger?: HostBuildLedger | undefined;
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
    if (body?.error) return { status: REFUSAL_STATUS[body.error] ?? 422, body };
    // Defense in depth: a host operation refusal that escaped as ArtifactOperationError still gets a closed,
    // non-retryable body instead of a 503 the builder would retry forever.
    const kind = error instanceof ArtifactOperationError ? String(error.kind) : "";
    const reason = HOST_REFUSAL_REASON[kind];
    return reason ? { status: 409, body: { v: 1, error: "handoff_mismatch", reason } } : UNAVAILABLE;
  };
  return {
    async job(body: unknown): Promise<HostEndpointResponse> {
      if (!verifyJobRequest || !resolvePendingJob || !refusalOf) return UNAVAILABLE;
      try {
        const claims = verifyJobRequest(body as never, { scopeId: input.scopeId, builderKeys, now: now() } as never) as {
          artifactId: string; jobId: string; fence: { runId: string; attempt: number } };
        const job = await ledger.admitJob(claims.artifactId, claims.jobId, (view) =>
          resolvePendingJob(view as never, claims.jobId as never, claims.fence as never) as { job: HostJob; fence: AttemptFence } | null);
        if (!job) return { status: 409, body: { v: 1, error: "handoff_mismatch", reason: "job_not_pending" } };
        return { status: 200, body: { v: 1, job } };
      } catch (error) { return refusal(error); }
    },
    async handoff(body: unknown): Promise<HostEndpointResponse> {
      if (!parseHandoffRequest || !acceptHandoff || !refusalOf || !input.keys.receiptKey) return UNAVAILABLE;
      try {
        const accept = { scopeId: input.scopeId, builderKeys, receiptKey: input.keys.receiptKey, now };
        // Authenticate before decoding: a malformed envelope is refused by parseHandoffRequest at its first
        // check (no file decoded); a well-formed one is authenticated by the probe before its files are decoded.
        if (record(body) && body.v === 1 && record(body.handoff)) {
          await Promise.resolve(acceptHandoff({ ...accept, ledger: { find: async () => { throw AUTHENTICATED; },
            transaction: async () => closed() }, view: async () => closed(), publish: async () => closed() } as never,
          body.handoff as never, [] as never)).catch((error: unknown) => { if (error !== AUTHENTICATED) throw error; });
        }
        const { handoff, files } = parseHandoffRequest(body as never) as { handoff: { claims: { artifactId: string; jobId: string } };
          files: unknown[] };
        const receipt = await acceptHandoff({ ...accept,
          ledger: ledger.ledger,
          view: (claims: HandoffClaims) => ledger.view(claims),
          publish: (claims: HandoffClaims, candidate: readonly CandidateFile[]) => ledger.publish(claims, candidate) } as never,
        handoff as never, files as never);
        return { status: 200, body: { v: 1, receipt } };
      } catch (error) { return refusal(error); }
    },
  };
}
export type LiveHostEndpoints = ReturnType<typeof createLiveHostEndpoints>;
