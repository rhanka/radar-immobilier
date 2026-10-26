import type { ArtifactCommitCoordinator, AuthorizeCommit, FinalizeRequest } from "@sentropic/artifacts/server/commit-contract";

/** Retain domain denials; a fresh host refusal after waits wins for finalize and replay. */
export function bindHostCoordinator(coordinator: ArtifactCommitCoordinator, currentGuard: () => AuthorizeCommit) {
  const bind = (request: FinalizeRequest): FinalizeRequest => ({ ...request,
    guard: async (context, transaction) => {
      const decision = await request.guard(context, transaction);
      const authority = await currentGuard()(context, transaction);
      if (!authority.allowed) return authority;
      return decision;
    },
  });
  return { ...coordinator,
    finalizePrepared: (request: FinalizeRequest) => coordinator.finalizePrepared(bind(request)),
    replayPrepared: (request: FinalizeRequest) => coordinator.replayPrepared(bind(request)),
  };
}
