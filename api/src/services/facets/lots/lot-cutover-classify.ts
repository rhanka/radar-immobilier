/**
 * 6K target classification shared by the status view and the gate.
 *
 * One target across its source rows. `activate` dispositions name the
 * winning source row explicitly; anything else stays out with an
 * explicit unavailable or pending status. No automatic newest-wins rule.
 */
import type { ManifestRow } from "../lot-migration-report/manifest.js";
import type { ActivationGate } from "./lot-cutover-types.js";

/** Classify one target across its source rows. */
export function classifyTarget(
  gate: ActivationGate, rows: ManifestRow[], key: string,
  disposition: { decision: string; sourceId: string | null } | null,
  mappingQualified: boolean,
): void {
  if (!mappingQualified) {
    gate.pending.push({ targetKey: key, cause: "destination-unqualified" });
    return;
  }
  if (rows.every((row) => row.disposition === "mapped")) {
    gate.ready.push(key);
    return;
  }
  if (rows.every((row) => row.disposition !== "conflict")) {
    gate.pending.push({
      targetKey: key,
      cause: rows.find((row) => row.disposition !== "mapped")?.disposition ?? "unresolved",
    });
    return;
  }
  if (disposition?.decision === "keep-pending") {
    gate.pending.push({ targetKey: key, cause: "d5-keep-pending" });
    return;
  }
  if (disposition?.decision !== "activate") {
    gate.unavailable.push(key);
    return;
  }
  const terminal = rows.filter((row) => row.disposition === "conflict"
    && row.destination !== null && (row.observed.supersededBy ?? null) === null);
  const winner = terminal.find((row) => row.sourceId === disposition.sourceId);
  if (!winner) {
    gate.unavailable.push(key);
    gate.reasons.push(`d5_ambiguous_head:${key}`);
    return;
  }
  gate.ready.push(key);
  gate.activatedSourceIds.push(winner.sourceId);
}
