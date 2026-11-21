import type { GraphSignalNode } from "./graph-signal-detail-client.js";

export function classAnnotationLabel(node: GraphSignalNode, manualOverride = false): string | null {
  const annotation = node.classAnnotation;
  if (node.classFeedback) return node.classFeedback.verdict === "up"
    ? "Validé par un humain" : "Reclassé par un humain";
  if (manualOverride || annotation?.source === "manual") return "Manuel";
  if (annotation?.source !== "ai") return null;
  const model = annotation.model?.trim() || "modèle inconnu";
  const date = annotation.updatedAt ? new Date(annotation.updatedAt).toLocaleDateString("fr-CA") : null;
  return `IA${annotation.ambiguous ? " · ambigu" : ""} · ${model} ${annotation.effort ?? ""} · prompt ${annotation.promptId ?? "inconnu"}${date ? ` · ${date}` : ""}`;
}
