// Runs INSIDE a node:24 container (make classif-l0-signals): reads graph projection rows (JSON
// array on stdin, same columns as listCitiesWithSignalNodes) and prints, per row, the B′ flags
// computed by the repository code itself, exactly as aggregateGraphSignalProjectionRows():
//   z = isZonageSignal · r = B′-eligible ∧ isResidentielPertinent · p = isPrecoceSignal ·
//   hidden = isHiddenByVivierBExclusions(PIIA without residential project, minor variances).
import { classifyBPrime, isHiddenByVivierBExclusions } from "@radar/domain";
import {
  classifyGraphNodeVivierV2,
  isPrecoceSignal,
  isResidentielPertinent,
  isZonageSignal,
} from "../../../api/src/services/graph/graph-store.ts";

interface Row {
  id: string; type: string; category: string | null; label: string; description: string | null;
  etapeAnnote: string | null; props: Record<string, unknown>; sourceRef: string | null;
}

const chunks: Buffer[] = [];
for await (const c of process.stdin) chunks.push(c as Buffer);
const rows = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Row[];
const out: unknown[] = [];
for (const row of rows) {
  const classification = classifyGraphNodeVivierV2(row);
  const hidden = isHiddenByVivierBExclusions(
    { label: row.label, description: row.description, props: row.props ?? {}, classification },
    { piiaSansProjetResidentiel: true, derogationsMineures: true },
  );
  const eligible = classifyBPrime({
    category: row.category, label: row.label, description: row.description,
    etapeAnnotation: row.etapeAnnote, props: row.props, sourceRef: row.sourceRef,
  }).exclusionReason === null;
  const r = eligible && isResidentielPertinent(row.category ?? row.etapeAnnote, row.label, row.description);
  const z = isZonageSignal(row.type, row.category, row.etapeAnnote);
  const p = isPrecoceSignal(row.etapeAnnote, row.label, row.description);
  out.push([row.id, z ? 1 : 0, r ? 1 : 0, p ? 1 : 0, hidden ? 1 : 0, classification.instrument, classification.etape]);
}
process.stdout.write(JSON.stringify(out));
