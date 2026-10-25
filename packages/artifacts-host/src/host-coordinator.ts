import type { ArtifactCommitCoordinator, AuthorizeCommit, FinalizeRequest } from "@sentropic/artifacts/server/commit-contract";

/** The request guard observes domain denials after waits, without overriding them. */
export function bindHostCoordinator(coordinator: ArtifactCommitCoordinator, currentGuard: () => AuthorizeCommit) {
  const bind = (request: FinalizeRequest): FinalizeRequest => ({ ...request,
    guard: async (context, transaction) => {
      const decision = await request.guard(context, transaction);
      if (!decision.allowed) await currentGuard()(context, transaction);
      return decision;
    },
  });
  return { ...coordinator,
    finalizePrepared: (request: FinalizeRequest) => coordinator.finalizePrepared(bind(request)),
    replayPrepared: (request: FinalizeRequest) => coordinator.replayPrepared(bind(request)),
  };
}
