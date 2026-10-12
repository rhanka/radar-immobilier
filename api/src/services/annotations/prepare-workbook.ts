import { canonicalJson, sha256Hex, hashRecord, type CanonicalImportManifest,
  type CanonicalScope, type CapacityDescriptor, type RevisionRegistration } from "@sentropic/comments";
import type { createAnnotationHostPorts } from "./host-ports.js";
import { inventorySyntheticWorkbook } from "./workbook-inventory.js";
import { prepareSyntheticSourceUnit } from "./prepare-source-unit.js";

/** Frozen technical inputs are explicit; no Steve attribution or account is inferred. */
export interface WorkbookPreparationOptions {
  scope: CanonicalScope;
  expectedSheetIds: readonly string[];
  registration: RevisionRegistration;
  mappingVersion: string;
  conversionVersion: string;
  executorService: string;
  executorRun: string;
}

/** Admissible candidates and common manifest only. M2/M3 owns commits and receipts. */
export async function prepareSyntheticWorkbook(rawUtf8: string, options: WorkbookPreparationOptions,
  host: ReturnType<typeof createAnnotationHostPorts>, capacity: CapacityDescriptor) {
  if ([options.mappingVersion, options.conversionVersion, options.executorService, options.executorRun]
    .some((value) => !value?.trim())) throw new Error("Frozen mapping and execution inputs are required");
  const inventory = inventorySyntheticWorkbook(rawUtf8, options.scope, options.expectedSheetIds);
  const candidates: Awaited<ReturnType<typeof prepareSyntheticSourceUnit>>[] = [];
  const blocked: Array<{ unitId: string; reason: string }> = [];
  for (const sheet of inventory.capture.sheets) {
    for (const contribution of sheet.contributions) {
      const sourceRecordId = canonicalJson([sheet.sheetId, contribution.row, contribution.id, contribution.cells]);
      const unitId = sha256Hex(canonicalJson([inventory.capture.sourceId, inventory.digest, sourceRecordId]));
      const row = inventory.resources.find((resource) => resource.ref.kind === "row" &&
        resource.locator === `sheet:${sheet.sheetId}!row:${contribution.row}`)!;
      try {
        candidates.push(await prepareSyntheticSourceUnit({ dataClass: "synthetic", unitId,
          scope: options.scope, kind: "discussion", primary: { resource: row.ref,
            source: { variant: "fixed-at-conversion", sourceVersion: inventory.digest,
              conversionRef: options.conversionVersion, historicalGap: true } },
          secondary: [], body: contribution.body, attribution: contribution.attribution,
          ...(contribution.sourceTime ? { sourceTime: contribution.sourceTime } : {}),
          execution: { sourceNamespace: "immo.workbook-capture", sourceRecordId,
            sourceVersion: inventory.digest, sourceDigest: inventory.digest,
            parserVersion: "immo-workbook-capture-v1", mappingVersion: options.mappingVersion,
            conversionVersion: options.conversionVersion, executorService: options.executorService,
            executorRun: options.executorRun } }, options.registration, host, capacity));
      } catch (error) {
        blocked.push({ unitId, reason: error instanceof Error ? error.message : "Source unit rejected" });
      }
    }
  }
  const units = candidates.map((candidate) => candidate.unit);
  const admissibleManifestDigest = sha256Hex(canonicalJson({ sourceDigest: inventory.digest, captureDigest: inventory.captureDigest,
    scope: options.scope, mappingVersion: options.mappingVersion, conversionVersion: options.conversionVersion, units }));
  const envelope = { scope: options.scope, importId: `immo-workbook-${admissibleManifestDigest}`,
    sourceUnitCount: units.length, admissibleManifestDigest, mappingVersion: options.mappingVersion };
  const manifest: CanonicalImportManifest = { ...envelope, kind: "import-manifest",
    hash: hashRecord("import-manifest", envelope) };
  return { inventory, candidates, blocked, manifest,
    counts: { sourceContributions: inventory.sourceContributionCount, prepared: candidates.length, blocked: blocked.length },
    status: "prepared-not-committed" as const };
}
