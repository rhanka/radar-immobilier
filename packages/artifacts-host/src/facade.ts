import { randomUUID } from "node:crypto";
import { isArtifactId } from "@sentropic/artifacts/contracts";
import { projectArtifactHttpOutcome, type HttpResponse } from "@sentropic/artifacts/http";

// Immo-side content projection (owner decision 2026-11-02): single-level UUID
// hosts on `pages.<app>`. Both stable (`<artifactId>.<base>/`) and exact
// (`<releaseId>.<base>/`, exposed as `pinnedUrl`) share one wildcard; the
// label resolves server-side as artifact or release. Upstream
// `@sentropic/artifacts@0.2.9` implements the same single-level scheme
// (`versionUrl` for the exact release); immo keeps `pinnedUrl` as its own
// opaque MCP/API contract and never imports the upstream routing subpath.
const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/**
 * Project the upstream 0.2.9 `versionUrl` wire field to the immo opaque
 * `pinnedUrl` contract on any response body (v1 root fields or v2
 * `output.*`, single objects or arrays such as `artifacts`/`versions`).
 * `versionUrl` never leaks: it is dropped wherever `pinnedUrl` is present
 * or derived, so `get`, `list`, `publish`/`revert` (v1/v2 HTTP and MCP),
 * `get_source` and `list_versions` all expose `pinnedUrl` only.
 */
export function projectContentUrls<T>(value: T): T {
  if (Array.isArray(value)) return value.map(projectContentUrls) as T;
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const projected: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(record)) {
      if (key === "versionUrl") continue;
      projected[key] = projectContentUrls(entry);
    }
    if (typeof record.versionUrl === "string" && typeof projected.pinnedUrl !== "string") {
      projected.pinnedUrl = record.versionUrl;
    }
    return projected as T;
  }
  return value;
}

/**
 * Id-collision guard: a release must never reuse its artifact id. A label
 * that is both an artifact and a release fails closed (404 on reads, throw
 * on publish) instead of serving the stable artifact silently like upstream.
 */
export function assertContentIdsDisjoint(artifactId: unknown, releaseId: unknown): void {
  if (typeof artifactId === "string" && typeof releaseId === "string" &&
    artifactId.toLowerCase() === releaseId.toLowerCase()) {
    throw new Error("invalid content links");
  }
}

function contentUrl(label: string, base: string): string | null {
  if (!UUID_RE.test(label) || !base || base.length > 253) return null;
  try {
    const url = new URL(`https://${label}.${base}/`);
    if (url.host !== `${label}.${base}`.toLowerCase() || url.pathname !== "/") return null;
    return `https://${label.toLowerCase()}.${base.toLowerCase()}/`;
  } catch {
    return null;
  }
}
import { projectArtifactWriteFailure } from "@sentropic/artifacts/server/outcome-contract";
import { authorizeArtifactCommit } from "./commit-policy.js";
import { checkAdmission, type AdmissionAuthority } from "./admission.js";
import type { composeArtifactHost } from "./composition.js";
import { HOST_ARTIFACT_PROFILE, isArtifactMutation } from "./p0b-profile.js";
import { artifactRefusalResponse } from "./result-projection.js";

export interface ArtifactControl {
  handle(op: string, actorId: string, body: unknown): Promise<HttpResponse>;
}

/**
 * Failure accounting for write dispatches (861C unit 7). Every refused or
 * failed commit is recorded with its cause; reads are never recorded.
 */
export type CommitFailureReason =
  | "unauthorized_at_commit"
  | "admission_unavailable"
  | "provider_conflict"
  | "provider_unavailable"
  | "provider_error";

export interface CommitFailureRecord {
  readonly invocationId: string;
  readonly op: string;
  readonly actorId: string;
  readonly reason: CommitFailureReason;
  readonly status: number;
  readonly atMs: number;
}

export interface CommitFailureLedger {
  record(entry: CommitFailureRecord): void | Promise<void>;
}

export function createMemoryCommitLedger(): {
  readonly ledger: CommitFailureLedger; readonly entries: CommitFailureRecord[];
} {
  const entries: CommitFailureRecord[] = [];
  return { ledger: { record: (entry) => { entries.push(entry); } }, entries };
}

export interface ArtifactControlOptions {
  readonly ledger?: CommitFailureLedger;
  readonly nowMs?: () => number;
}

type ComposedHost = NonNullable<Awaited<ReturnType<typeof composeArtifactHost>>>;
type Host = { readonly app: Pick<ComposedHost["app"], "execute"> } & Partial<Pick<ComposedHost, "execute" | "profile">>;

export function createArtifactControl(
  host: Host,
  scope: string,
  contentBase = "",
  admission?: AdmissionAuthority | undefined,
  options?: ArtifactControlOptions | undefined,
): ArtifactControl {
  // Captured at binding construction: deployment changes never reshape an in-flight response.
  const profile = host.profile ?? HOST_ARTIFACT_PROFILE;
  const refused = (status: number, code: string) => artifactRefusalResponse(status, code, status === 503, {}, profile.resultEnvelopeVersion);
  const denied = (status: number, body: { error: string }) => {
    const { error, ...details } = body;
    return artifactRefusalResponse(status, error, false, details, profile.resultEnvelopeVersion);
  };
  const invalid = () => refused(400, "invalid_request");
  const control: ArtifactControl = {
    async handle(op, actorId, raw) {
      if (!profile.selectedCapabilities.some((name) => name === `artifacts_${op === "meta" ? "get" : op}`)) {
        return refused(503, "capability_unavailable");
      }
      let frozenWorkspace: string | undefined;
      if (admission) {
        let entry;
        try {
          entry = await checkAdmission(admission, actorId, scope);
        } catch {
          const unavailable = refused(503, "capability_unavailable");
          Object.defineProperty(unavailable, "retryable", { value: true });
          return unavailable;
        }
        if (!entry.allowed) return denied(entry.status, entry.body);
        // General opening reports no workspace: nothing is frozen and the
        // commit reread below cannot diverge from it.
        frozenWorkspace = entry.workspaceId === "" ? undefined : entry.workspaceId;
      }
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid();
      const body = raw as Record<string, unknown>;
      if (body.storageScopeId !== undefined && body.storageScopeId !== scope) return invalid();
      const artifactId = body.artifactId;
      // I2 on G2 — lookup_people is artifact-free by provider design (the
      // account directory is global); every other op still names its page.
      if (!["ensure", "list", "lookup_people"].includes(op) && !isArtifactId(artifactId)) return invalid();
      let stableUrl: string | undefined;
      if (op === "publish") {
        if (!contentBase) return invalid();
        stableUrl = contentUrl(String(artifactId), contentBase) ?? undefined;
        if (!stableUrl) return invalid();
      }
      const write = isArtifactMutation(op);
      if (write && (typeof body.idempotencyKey !== "string" || !body.idempotencyKey.trim() ||
        body.idempotencyKey.length > 256)) return invalid();
      if (write && admission) {
        let commit;
        try {
          commit = await checkAdmission(admission, actorId, scope);
        } catch {
          const unavailable = refused(503, "capability_unavailable");
          Object.defineProperty(unavailable, "retryable", { value: true });
          return unavailable;
        }
        if (!commit.allowed) return denied(commit.status, commit.body);
        if (frozenWorkspace !== undefined && commit.workspaceId !== frozenWorkspace) {
          return refused(403, "workspace_membership_required");
        }
        if (commit.workspaceId !== "") frozenWorkspace = commit.workspaceId;
      }
      const invocation = Object.freeze({ invocationId: randomUUID(), actorId, storageScopeId: scope,
        authorizeCommit: async (...args: Parameters<typeof authorizeArtifactCommit>) => {
          if (admission) {
            const [context, transaction] = args;
            const participant = (transaction as { participant?: {
              checkApproval?: (input: { actorId: string; operation: string }) => Promise<{
                approved?: unknown; publicCode?: unknown; status?: unknown; workspaceId?: unknown }>;
            } } | null | undefined)?.participant;
            if (participant && typeof participant.checkApproval === "function") {
              try {
                const approval = await participant.checkApproval({ actorId, operation: context.operation });
                if (approval && typeof approval.approved === "boolean" && approval.approved === false) {
                  const publicCode = typeof approval.publicCode === "string" &&
                    /^[a-z][a-z0-9_]{0,63}$/.test(approval.publicCode)
                    ? approval.publicCode : "access_denied";
                  const status = approval.status === 409 ? 409 : 403;
                  return { allowed: false as const, reason: "denied" as const,
                    publicCode, status, retriable: false };
                }
                if (frozenWorkspace !== undefined && typeof approval?.workspaceId === "string" &&
                  approval.workspaceId.toLowerCase() !== frozenWorkspace.toLowerCase()) {
                  return { allowed: false as const, reason: "denied" as const,
                    publicCode: "workspace_membership_required", status: 403, retriable: false };
                }
              } catch {
                return { allowed: false as const, reason: "unavailable" as const,
                  publicCode: "capability_unavailable", status: 503, retriable: true };
              }
            } else {
              let decision;
              try { decision = await checkAdmission(admission, actorId, scope); }
              catch { return { allowed: false as const, reason: "unavailable" as const,
                publicCode: "capability_unavailable", status: 503, retriable: true }; }
              if (!decision.allowed) return { allowed: false as const, reason: "denied" as const,
                publicCode: decision.body.error, status: decision.status, retriable: false };
              if (frozenWorkspace !== undefined && decision.workspaceId !== frozenWorkspace) {
                return { allowed: false as const, reason: "denied" as const,
                  publicCode: "workspace_membership_required", status: 403, retriable: false };
              }
            }
          }
          return authorizeArtifactCommit(...args);
        } });
      const effective = op === "meta" ? {} : op === "list" ? {
        limit: body.limit === undefined ? 20 : Number(body.limit),
        offset: body.offset === undefined ? 0 : Number(body.offset),
      } : body;
      // Files parity LOT 1 — the provider serves the upload channel on
      // dedicated routes, not `/${op}`.
      const uploadPath = op === "create_upload" ? "/uploads/create"
        : op === "commit_upload" ? "/uploads/commit" : undefined;
      const outcome = await (host.execute ?? host.app.execute)({ actorId, body: effective,
        method: op === "meta" ? "GET" : "POST",
        path: op === "meta" ? `/meta/${String(artifactId)}` : (uploadPath ?? `/${op}`) }, invocation);
      if (!outcome.ok) {
        const entry = projectArtifactWriteFailure(outcome.failure, { dispatched: true, write });
        if (entry) await options?.ledger?.record({ invocationId: entry.invocationId, op, actorId,
          reason: entry.reason, status: entry.status, atMs: (options?.nowMs ?? Date.now)() });
      }
      const hasConflictSource = !outcome.ok && outcome.failure.conflict?.currentSource !== undefined;
      if (admission && ((outcome.ok && ["get_source", "list_versions"].includes(op)) || hasConflictSource)) {
        let current;
        try { current = await checkAdmission(admission, actorId, scope); }
        catch {
          const unavailable = refused(503, "capability_unavailable");
          Object.defineProperty(unavailable, "retryable", { value: true });
          return unavailable;
        }
        if (!current.allowed) return denied(current.status, current.body);
      }
      const projectedOutcome = projectArtifactHttpOutcome(outcome, profile.resultEnvelopeVersion === 2);
      const response = { ...projectedOutcome, body: projectContentUrls(projectedOutcome.body) };
      if (!outcome.ok && outcome.failure.publicCode === "rate_limited" && profile.resultEnvelopeVersion !== 2) {
        response.body = { error: "rate_limited", retryable: outcome.failure.retriable };
      }
      Object.defineProperty(response, "retryable", { value: !outcome.ok && outcome.failure.retriable });
      if ((op === "publish" || op === "revert") && response.status === 201) {
        const payload = (response.body as { output?: unknown }).output ?? response.body;
        const record = payload as { releaseId?: unknown; manifest?: unknown };
        assertContentIdsDisjoint(artifactId, record.releaseId);
        if (profile.resultEnvelopeVersion !== 2) {
          const result = response.body as { releaseId: string; manifest: string };
          const manifest = JSON.parse(result.manifest) as { digest: string };
          // Exact-version URL shares the single wildcard (no `pinned` label). The
          // `pinnedUrl` field name stays as the opaque MCP/API contract.
          const pinnedUrl = contentUrl(result.releaseId, contentBase);
          if (!pinnedUrl) throw new Error("invalid content links");
          return { status: 201, body: projectContentUrls({ ...result, artifactId, releaseId: result.releaseId, digest: manifest.digest,
            stableUrl, pinnedUrl }) };
        }
        return response;
      }
      return response;
    },
  };
  return control;
}
