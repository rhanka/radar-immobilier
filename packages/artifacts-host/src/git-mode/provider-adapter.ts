import * as provider from "@sentropic/artifacts";
import type { GitBuildJobRequest, GitToolService, GitToolsDeps } from "@sentropic/artifacts";

/**
 * Provider seam for the git tools (M1, routed by `createHttpArtifactApp`
 * through `deps.gitTools` since 0.2.20): `createGitToolService` and its
 * contract types come straight from `@sentropic/artifacts`; immo keeps no
 * local copy of them.
 */
export type {
  GitBuildJobRequest, GitBuildJobState, GitBuildPort, GitToolAuthority, GitToolInvocation, GitToolService, GitToolsDeps,
} from "@sentropic/artifacts";
export type GitBuildExecutor = GitBuildJobRequest["executor"];

/** Name of the `createHttpArtifactApp` dependency that routes the three tools (M1). */
export const GIT_TOOLS_DEP_KEY = "gitTools" as const;

type Factory = (deps: GitToolsDeps) => GitToolService;

/** Fail-closed: throws unless the given provider namespace exports `createGitToolService` (0.2.20+). */
export function gitToolServiceFactory(namespace: Record<string, unknown> = provider as unknown as Record<string, unknown>): Factory {
  const factory = namespace.createGitToolService;
  if (typeof factory !== "function") throw new Error("artifact_git_tools_provider_missing");
  return factory as Factory;
}
