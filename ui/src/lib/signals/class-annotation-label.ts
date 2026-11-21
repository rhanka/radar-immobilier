import type { GraphSignalNode } from "./graph-signal-detail-client.js";

/** AI provenance badge (`IA · <model> ...`), or null when no AI annotation exists. */
export function aiAnnotationLabel(node: GraphSignalNode): string | null {
  const annotation = node.classAnnotation;
  if (annotation?.source !== "ai") return null;
  const model = annotation.model?.trim() || "modèle inconnu";
  const date = annotation.updatedAt ? new Date(annotation.updatedAt).toLocaleDateString("fr-CA") : null;
  return `IA${annotation.ambiguous ? " · ambigu" : ""} · ${model} ${annotation.effort ?? ""} · prompt ${annotation.promptId ?? "inconnu"}${date ? ` · ${date}` : ""}`;
}

/** Human provenance badge (`Manuel`, or feedback verdict), or null when no human class exists. */
export function humanAnnotationLabel(node: GraphSignalNode, hasManualClass = false): string | null {
  if (node.classFeedback) {
    return node.classFeedback.verdict === "up"
      ? "Validé par un humain" : "Reclassé par un humain";
  }
  if (hasManualClass || node.classAnnotation?.source === "manual") return "Manuel";
  return null;
}

/** Primary single-badge provenance helper: human if present, else AI, else null (never "Manuel" on untouched Non classé). */
export function classAnnotationLabel(node: GraphSignalNode, manualOverride = false): string | null {
  return humanAnnotationLabel(node, manualOverride) ?? aiAnnotationLabel(node);
}
