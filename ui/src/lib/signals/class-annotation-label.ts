import type { GraphSignalNode } from "./graph-signal-detail-client.js";

export function classAnnotationLabel(node: GraphSignalNode, manualOverride = false): string {
  const annotation = node.classAnnotation;
  if (node.classFeedback) return node.classFeedback.verdict === "up"
    ? "Validé par un humain" : "Reclassé par un humain";
  if (manualOverride || annotation?.source !== "ai") return "Manuel";
  const model = annotation.model?.trim() || "modèle inconnu";
  const date = annotation.updatedAt ? new Date(annotation.updatedAt).toLocaleDateString("fr-CA") : null;
  return `IA · ${model} ${annotation.effort ?? ""} · prompt ${annotation.promptId ?? "inconnu"}${date ? ` · ${date}` : ""}`;
}
