import { createGitRepositoryRegistry, type GitRepositoryRegistry } from "@sentropic/artifacts";

/**
 * A1 registry entry of `rhanka/radar-immobilier`, statically pinned
 * (docs/operator/git-artifact-a1-registry.md). It is host configuration,
 * never a tool argument. A-LIVE §3.1 adds the npm/yarn configuration files
 * and the descriptor output subtree to the refused paths, so a branch can
 * neither redirect the locked install nor commit built output.
 */
export const IMMO_GIT_REPO_ID = "radar-immobilier" as const;
export const IMMO_GIT_LOCATOR = "rhanka/radar-immobilier" as const;
/** Descriptor output subtree (sentropic.artifact.json `outputDir`), excluded from writes. */
export const IMMO_GIT_OUTPUT_DIR = "ui/dist" as const;

export const IMMO_GIT_WRITABLE_PATHS: readonly string[] = Object.freeze([
  "ui/**",
  "packages/radar-domain/src/**",
  "packages/radar-scoring/src/**",
  "packages/radar-sources/src/**",
]);

export const IMMO_GIT_REFUSED_WRITE_PATHS: readonly string[] = Object.freeze([
  ".github/**",
  "deploy/**",
  "api/**",
  ".track/**",
  "packages/immo-mcp/**",
  "package*.json",
  "**/package*.json",
  // A-LIVE §3.1 additions.
  ".npmrc",
  "**/.npmrc",
  ".yarnrc*",
  "**/.yarnrc*",
  "ui/dist/**",
]);

export interface ImmoGitRegistryInput {
  readonly storageScopeId: string;
  /**
   * Opaque SG0-app installation reference returned by the owner enrollment
   * (`/github-app/<installationRef>/status` = ready). Absent until the
   * enrollment exists: the registry is then empty and every git tool answers
   * `git_repo_not_registered` (fail-closed).
   */
  readonly installationRef?: string | undefined;
}

export function immoGitRepositoryEntry(input: { readonly storageScopeId: string; readonly installationRef: string }) {
  return Object.freeze({
    repoId: IMMO_GIT_REPO_ID,
    storageScopeId: input.storageScopeId,
    forge: "github-app" as const,
    locator: IMMO_GIT_LOCATOR,
    installationRef: input.installationRef,
    // Inbound webhooks are not consumed by immo (no reconcile-on-push yet).
    webhookSecretRef: "none",
    branchPrefix: "artifact/" as const,
    allowedSubPaths: [""],
    writablePaths: [...IMMO_GIT_WRITABLE_PATHS],
    refusedWritePaths: [...IMMO_GIT_REFUSED_WRITE_PATHS],
    publicationPolicy: { personalBranchPrefix: "artifact/p/" as const, sharedPublishers: [],
      delegatedPublication: "personal-only" as const },
    canWrite: true,
    codePolicyRef: "immo-a1-2026-11-05",
  });
}

export function createImmoGitRegistry(input: ImmoGitRegistryInput): GitRepositoryRegistry {
  const installationRef = input.installationRef?.trim();
  if (!input.storageScopeId.trim()) throw new Error("artifact_git_registry_scope_missing");
  return createGitRepositoryRegistry(installationRef
    ? [immoGitRepositoryEntry({ storageScopeId: input.storageScopeId, installationRef })] : []);
}
