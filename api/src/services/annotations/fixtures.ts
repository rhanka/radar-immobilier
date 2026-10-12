import type { CapacityDescriptor, CanonicalScope, RevisionBody, ImportExecution } from "@sentropic/comments";

/** Synthetic policy values are test inputs, never deployment defaults. */
export const SYNTHETIC_CAPACITY: CapacityDescriptor = {
  body: { limit: 1_000_000, unit: "utf8-bytes" },
  segment: { limit: 1_000_000, unit: "utf8-bytes" },
  profile: { limit: 10_000, unit: "canonical-bytes" },
  unitManifest: { limit: 2_000_000, unit: "canonical-bytes" },
  unitPayload: { limit: 2_000_000, unit: "canonical-bytes" },
  batchUnits: { limit: 100, unit: "units" },
  batchManifest: { limit: 2_000_000, unit: "canonical-bytes" },
  batchRequest: { limit: 3_000_000, unit: "canonical-bytes" },
  pageRecords: { limit: 100, unit: "records" },
  pageEncodedBytes: { limit: 2_000_000, unit: "canonical-bytes" },
};
export const SYNTHETIC_SCOPE: CanonicalScope = { tenantId: "synthetic-team", workspaceId: "synthetic-workspace" };
export const SYNTHETIC_BODY: RevisionBody = {
  text: "Synthetic contribution\r\n😀 with exact spacing  ",
  codec: { format: "plain", codecId: "plain-v1", specDigest: "spec-digest-plain-1", extensions: [] },
};
export const SYNTHETIC_EXECUTION: ImportExecution = {
  sourceNamespace: "synthetic-sheet", sourceRecordId: "row-1/contribution-1", sourceVersion: "source-v1",
  sourceDigest: "a".repeat(64), parserVersion: "synthetic-parser-v1", mappingVersion: "immo-m1-v1",
  conversionVersion: "synthetic-v1", executorService: "immo-qualification", executorRun: "frozen-run-1",
};
