import * as provider from "@sentropic/artifacts";
import type { GitBindingStore, GitCodeRightsPort, GitPort, GitRepositoryRegistry } from "@sentropic/artifacts";

/**
 * Isolation seam for the 0.2.20 provider symbols (M1: `createGitToolService`
 * and the `gitTools` dependency of `createHttpArtifactApp`, which route
 * fetch_app_source, git_attach and git_publish).
 *
 * The shapes below mirror the M1 wagon (`server/git-tools-contracts.ts`,
 * sentropic `feat/artifacts-route-git-tools`) structurally.
 * TODO(0.2.20): replace them with `import type { GitToolService, GitToolsDeps,
 * GitBuildPort, ... } from "@sentropic/artifacts"` in the pin PR and delete
 * the local copies. Until then the factory lookup fails closed: under 0.2.18
 * `createGitToolService` does not exist and the composition refuses.
 */
export interface GitToolInvocation { actorId: string; storageScopeId: string; invocationId: string }
export interface GitToolAuthority { ownerId: string; canWrite: boolean }
export type GitBuildExecutor = "caller" | "ci" | "sandbox";
export type GitBuildJobState = "build_pending" | "building" | "published" | "build_failed" | "cancelled";
export interface GitBuildJobRequest {
  storageScopeId: string; artifactId: string; repoId: string; branch: string; subPath: string;
  commitSha: string; bindingGeneration: number; expectedCurrentReleaseId: string | null;
  executor: GitBuildExecutor; requestedBy: string; idempotencyKey: string;
}
export interface GitBuildPort {
  admits(executor: GitBuildExecutor): Promise<boolean>;
  request(job: GitBuildJobRequest): Promise<{ jobId: string; state: GitBuildJobState }>;
}
export interface GitToolsDeps {
  bindings: GitBindingStore;
  registry: GitRepositoryRegistry;
  codeRights: GitCodeRightsPort;
  git: GitPort;
  authorize(invocation: GitToolInvocation, artifactId: string): Promise<GitToolAuthority>;
  build?: GitBuildPort;
  outputDir?: string;
  journal?: (entry: { actorId: string; repoId: string; commitSha: string; invocationId: string }) => void | Promise<void>;
  now?: () => Date;
}
export interface GitToolService {
  execute(operation: string, args: Record<string, unknown>, invocation: GitToolInvocation): Promise<Record<string, unknown>>;
}

/** Name of the `createHttpArtifactApp` dependency that routes the three tools (M1). */
export const GIT_TOOLS_DEP_KEY = "gitTools" as const;

type Factory = (deps: GitToolsDeps) => GitToolService;

/** Fail-closed: throws unless the pinned provider exports `createGitToolService`. */
export function gitToolServiceFactory(namespace: Record<string, unknown> = provider as unknown as Record<string, unknown>): Factory {
  const factory = namespace.createGitToolService;
  if (typeof factory !== "function") throw new Error("artifact_git_tools_provider_missing");
  return factory as Factory;
}
