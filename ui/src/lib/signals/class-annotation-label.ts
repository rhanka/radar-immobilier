import type { GraphSignalNode } from "./graph-signal-detail-client.js";

export function classAnnotationLabel(node: GraphSignalNode, manualOverride = false): string {
  const annotation = node.classAnnotation;
  if (manualOverride || annotation?.source !== "ai") return "Manuel";
  const model = annotation.model?.toLowerCase().includes("astra") ? "GPT-6 Astra"
    : annotation.model?.toLowerCase().includes("gemini") ? "Gemini 3.8 Flash" : annotation.model;
  return `IA · ${model ?? "modèle inconnu"} ${annotation.effort ?? ""} · prompt ${annotation.promptId ?? "inconnu"}`;
}
