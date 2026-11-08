import type { GitBindingStore } from "@sentropic/artifacts";
import { ArtifactOperationError } from "@sentropic/artifacts/server/outcome-contract";

/**
 * Git binding coordinates sent to the Sentropic builder on `POST v1/builds` and
 * `POST v1/live/reconcile` (forge-lease-reader contract §1 / §7). `repoId` is the
 * opaque registry handle, `branch` the bound `artifact/...` branch, `subPath` the
 * binding subPath ('' = whole repo). The builder validates them against its own registries.
 */
export interface BuilderBinding { readonly repoId: string; readonly branch: string; readonly subPath: string }

/** Only the read side of the package binding store is needed. */
export type BuilderBindingSource = Pick<GitBindingStore, "get">;

/**
 * Reads the package git binding of THIS artifact and THIS binding generation (never caller input).
 * Fail-closed with the typed `git_not_attached` before any builder call when no attached binding of
 * that exact generation exists (detached, absent, or the current binding moved to another generation).
 * No binding source composed: `provider_unavailable`.
 */
export async function resolveBuilderBinding(source: BuilderBindingSource | undefined,
  identity: { readonly storageScopeId: string; readonly artifactId: string; readonly bindingGeneration: number }): Promise<BuilderBinding> {
  if (!source) throw new ArtifactOperationError("provider_unavailable");
  const binding = await source.get(identity.storageScopeId, identity.artifactId);
  if (!binding || binding.state === "detached" || binding.generation !== identity.bindingGeneration ||
    typeof binding.repoId !== "string" || typeof binding.branch !== "string" || typeof binding.subPath !== "string") {
    throw new ArtifactOperationError("git_not_attached");
  }
  return { repoId: binding.repoId, branch: binding.branch, subPath: binding.subPath };
}
