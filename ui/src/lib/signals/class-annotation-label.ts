import type { GraphSignalNode } from "./graph-signal-detail-client.js";

export function classAnnotationLabel(node: GraphSignalNode, manualOverride = false): string {
  const annotation = node.classAnnotation;
  if (manualOverride || annotation?.source !== "ai") return "Manuel";
  const model = annotation.model?.trim() || "modèle inconnu";
  return `IA${annotation.ambiguous ? " · ambigu" : ""} · ${model} ${annotation.effort ?? ""} · prompt ${annotation.promptId ?? "inconnu"}`;
}
