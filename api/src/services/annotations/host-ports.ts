import {
  canonicalJson, isCanonicalScope, isResourceRef,
  type CapabilityCheckPort, type CanonicalScope, type CommandCapability,
  type DecisionResolutionPort, type ResourceRef, type ResourceResolverPort,
  type RevisionTargetBinding, type ResolverOutcome,
} from "@sentropic/comments";

/** Host metadata only: never a parallel annotation/review/content store. */
export interface RegisteredResource {
  ref: ResourceRef;
  sourceVersion: string;
  frozenDigest: string;
  currentDigest: string | null;
  available: boolean;
}

export interface AnnotationHostRepository {
  hasCapability(principal: string, scope: CanonicalScope, capability: CommandCapability): Promise<boolean>;
  resources(ref: ResourceRef): Promise<readonly RegisteredResource[]>;
}

/** Version-specific snapshot identity. A new version needs an explicit linked conversion. */
export function snapshotResource(input: {
  scope: CanonicalScope; namespace: string; citySlug: string;
  kind: string; nativeId: string; sourceVersion: string;
}): ResourceRef {
  if (!isCanonicalScope(input.scope) ||
      [input.namespace, input.citySlug, input.kind, input.nativeId, input.sourceVersion]
        .some((s) => typeof s !== "string" || s.length === 0) ||
      (input.namespace === "immo.graph" && input.nativeId.startsWith("gn-"))) {
    throw new Error("A qualified native resource identity and version are required");
  }
  return { scope: input.scope, namespace: input.namespace, kind: input.kind,
    id: canonicalJson([input.citySlug, input.kind, input.nativeId, input.sourceVersion]) };
}

export function createAnnotationHostPorts(repository: AnnotationHostRepository) {
  async function readable(principal: string, ref: ResourceRef): Promise<boolean> {
    return isResourceRef(ref) && repository.hasCapability(principal, ref.scope, "read");
  }
  async function resolve(principal: string, ref: ResourceRef): Promise<ResolverOutcome> {
    if (!(await readable(principal, ref))) return "unavailable";
    const resources = await repository.resources(ref);
    if (resources.length === 0) return "unavailable";
    if (resources.length !== 1) return "unresolved";
    const resource = resources[0]!;
    if (!resource.available || resource.currentDigest === null) return "unavailable";
    return resource.frozenDigest === resource.currentDigest ? "exact" : "source-changed";
  }
  const capabilities: CapabilityCheckPort = {
    async check(principal, capability, targets) {
      if (!principal || targets.length === 0 || targets.some((target) => !isResourceRef(target))) return false;
      const first = targets[0]!.scope;
      for (const target of targets) {
        if (!isResourceRef(target) || target.scope.tenantId !== first.tenantId ||
            target.scope.workspaceId !== first.workspaceId ||
            !(await readable(principal, target)) ||
            !(await repository.hasCapability(principal, target.scope, capability))) return false;
        const rows = await repository.resources(target);
        if (rows.length !== 1 || !rows[0]!.available) return false;
      }
      return true;
    },
  };
  const resolver: ResourceResolverPort = { resolve };
  // No human authority configured: possession of an admin account never invents G4.
  const decisions: DecisionResolutionPort = { resolve: async () => null };
  async function resolveBinding(principal: string, binding: RevisionTargetBinding): Promise<ResolverOutcome> {
    const outcome = await resolve(principal, binding.resource);
    if (outcome !== "exact") return outcome;
    if (binding.source.variant === "unknown") return "unresolved";
    const [registered] = await repository.resources(binding.resource);
    return registered?.sourceVersion === binding.source.sourceVersion ? "exact" : "source-changed";
  }
  return { capabilities, resolver, decisions, resolveBinding };
}
