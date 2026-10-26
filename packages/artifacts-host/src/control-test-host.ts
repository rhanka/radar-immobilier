import type { ArtifactInvocationContext } from "@sentropic/artifacts/server/commit-contract";
import type { HttpRequest, HttpResponse } from "@sentropic/artifacts/http";
import { ArtifactOperationError, classifyArtifactFailure } from "@sentropic/artifacts/server/outcome-contract";
import type { createArtifactControl } from "./facade.js";
import { normalizeHostOutcome } from "./host-outcome.js";

/** Transport-only double: real persistence and races are covered by the SQL suites. */
export function controlTestHost(work: (request: HttpRequest, invocation: ArtifactInvocationContext) => Promise<HttpResponse>) {
  return { app: { async execute(request: HttpRequest, invocation: ArtifactInvocationContext) {
    try {
      const result = await work(request, invocation);
      if (result.status >= 400) throw new ArtifactOperationError(
        result.status === 409 ? "command_conflict" : "provider_unavailable");
      if (request.method === "POST" && request.path !== "/list") {
        const decision = await invocation.authorizeCommit({ invocationId: invocation.invocationId,
          actorId: invocation.actorId, storageScopeId: invocation.storageScopeId, operation: request.path.slice(1),
          artifactId: "", bindingId: "", commandIdentity: {} as never, policyRevision: "test", purpose: "finalize" },
        { participant: {
          readRevision: async () => "test", readAdmission: async () => ({ allowed: true }),
          mintFence: () => ({}),
        } } as never);
        if (!decision.allowed) throw new ArtifactOperationError("unauthorized_at_commit", { refusal: decision });
      }
      return { ok: true as const, result, invocationId: invocation.invocationId, commitState: "committed" as const,
        replayed: false };
    } catch (cause) {
      return normalizeHostOutcome({ ok: false as const, failure: classifyArtifactFailure(cause,
        { invocationId: invocation.invocationId, operation: request.path.slice(1),
          phase: "dispatch", commitState: "not_committed" }) });
    }
  } } } as unknown as Parameters<typeof createArtifactControl>[0];
}
