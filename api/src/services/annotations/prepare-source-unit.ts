import {
  canonicalJson, sha256Hex, createAnnotationRevision, createThreadStructureRevision,
  createCommentRevision, isSourceVersionIndicator, validateRevisionTargets,
  type CanonicalImportUnit, type CanonicalScope, type CapacityDescriptor,
  type DocumentaryAttribution, type ImportExecution, type RevisionBody,
  type RevisionRegistration, type RevisionTargetBinding, type SourceTime,
  type CanonicalChainRecord,
} from "@sentropic/comments";
import type { createAnnotationHostPorts } from "./host-ports.js";

/** Already separated homogeneous contributions; source formulas/values stay with immo. */
export interface SyntheticSourceContribution {
  dataClass: "synthetic";
  unitId: string;
  scope: CanonicalScope;
  kind: "annotation" | "discussion";
  primary: RevisionTargetBinding;
  secondary: readonly RevisionTargetBinding[];
  body: RevisionBody;
  attribution: DocumentaryAttribution;
  sourceTime?: SourceTime;
  execution: ImportExecution;
}

/** Pure preparation: no store, object writes, review events, or AI dispatch. */
export async function prepareSyntheticSourceUnit(
  input: SyntheticSourceContribution,
  registration: RevisionRegistration,
  host: ReturnType<typeof createAnnotationHostPorts>,
  capacity: CapacityDescriptor,
) {
  if (input.dataClass !== "synthetic" || !input.unitId ||
      (input.kind !== "annotation" && input.kind !== "discussion")) {
    throw new Error("Only explicitly synthetic source units are allowed during M1 qualification");
  }
  validateRevisionTargets(input.scope, input.primary, input.secondary);
  const targets = [input.primary, ...input.secondary];
  if (targets.some((t) => !isSourceVersionIndicator(t.source))) {
    throw new Error("Invalid shared source-version evidence");
  }
  if (input.kind === "discussion" && input.secondary.length > 0) {
    throw new Error("Free discussions have one primary resource in M1");
  }
  if (!(await host.capabilities.check(registration.principal, "comment", targets.map((t) => t.resource)))) {
    throw new Error("Source unit access denied");
  }
  for (const target of targets) {
    const historical = target.source.variant === "unknown" &&
      target.resource.namespace === "immo.history" && target.resource.kind === "historical-source";
    const outcome = historical ? await host.resolver.resolve(registration.principal, target.resource)
      : await host.resolveBinding(registration.principal, target);
    if (outcome !== "exact") {
      throw new Error("Source unit requires qualified exact resource bindings");
    }
  }
  const identity = sha256Hex(canonicalJson({ scope: input.scope, unitId: input.unitId,
    sourceNamespace: input.execution.sourceNamespace, sourceRecordId: input.execution.sourceRecordId,
    sourceVersion: input.execution.sourceVersion, mappingVersion: input.execution.mappingVersion,
    conversionVersion: input.execution.conversionVersion }));
  const provenance = { registration, attribution: input.attribution,
    importExecution: input.execution,
    ...(input.sourceTime ? { sourceTime: input.sourceTime } : {}) };
  let records: readonly CanonicalChainRecord[];
  if (input.kind === "annotation") {
    records = [createAnnotationRevision(null, {
      scope: input.scope, annotationId: `immo-ann-${identity}`, primary: input.primary,
      secondary: input.secondary, body: input.body, visualAnchors: [], provenance,
    }, capacity)];
  } else {
    const structure = createThreadStructureRevision(null, {
      scope: input.scope, threadId: `immo-thread-${identity}`, primary: input.primary,
      trigger: "initial-registration", annotationId: null, provenance,
    }, capacity);
    const comment = createCommentRevision(null, {
      scope: input.scope, threadId: structure.threadId, commentId: `immo-comment-${identity}`,
      parentCommentId: null, structureRevision: { id: structure.threadId, hash: structure.hash },
      annotationPin: null, body: input.body, provenance,
    }, capacity);
    records = [structure, comment];
  }
  const unit: CanonicalImportUnit = {
    unitId: input.unitId, unitKind: input.kind, dependsOnUnitIds: [],
    manifestDigest: sha256Hex(canonicalJson(input)),
    payloadDigest: sha256Hex(canonicalJson(records)),
  };
  // These are candidates. Only the common service may commit and issue import receipts.
  return { unit, records };
}
