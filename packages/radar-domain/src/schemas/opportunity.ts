import { z } from "zod";
import { Mode, Confidence } from "./common.js";
import { Axis, AxisScore } from "./score.js";

export const Phase = z.enum([
  "signal",
  "ancrage",
  "contraintes",
  "marche",
  "contexte",
  "scoring",
]);

export const Verification = z.enum(["fait", "hypothese", "non-disponible", "simulé"]);

export const EvidenceItem = z
  .object({
    phase: Phase,
    sourceId: z.string().min(1),
    label: z.string().min(1),
    url: z.string().url().optional(),
    date: z.string().min(4),
    obtentionMode: z.enum([
      "download",
      "api",
      "scraping",
      "ocr-llm",
      "transcription",
      "manual",
    ]),
    confidence: Confidence,
    verification: Verification,
    value: z.string().optional(),
  })
  .refine((e) => e.verification !== "fait" || !!e.url, {
    message:
      "a verified ('fait') evidence item requires a source url",
  });

export const SourceRole = z.object({
  sourceId: z.string(),
  phase: Phase,
  role: z.string(),
  tier: z.enum(["A", "B", "C"]),
  accessibilite: z.enum([
    "public-free",
    "public-api",
    "account",
    "paid",
    "manual",
    "excluded",
  ]),
});

export const ZonePolygonSource = z.enum([
  "open-data-ckan",
  "wms-municipal",
  "vectorised-pdf",
  "hypothese-street-name",
  "other",
]);
export type ZonePolygonSourceT = z.infer<typeof ZonePolygonSource>;

export const ScoreSet = z.object({
  potentiel: z.number().min(0).max(5),
  risque: z.number().min(0).max(5),
  timing: z.number().min(0).max(5),
  faisabilite: z.number().min(0).max(5),
  marche: z.number().min(0).max(5),
});

export const OpportunityDossier = z.object({
  id: z.string(),
  title: z.string(),
  bylaw: z.string(),
  zone: z.string(),
  address: z.string(),
  signalId: z.string().min(1),
  mode: Mode.default("real"),
  lots: z.array(
    z.object({
      noLot: z.string(),
      matricule: z.string().optional(),
      superficie: z.string().optional(),
      usage: z.string().optional(),
      valeur: z.string().optional(),
      confirmed: z.boolean().default(false),
      zonePolygonSource: ZonePolygonSource.default("hypothese-street-name"),
      assemblyClusterId: z.string().optional(),
      metadata: z.record(z.unknown()).optional(),
    })
  ),
  evidence: z.array(EvidenceItem),
  scores: ScoreSet,
  scoreGlobal: z.number(),
  recommendation: z.string(),
  axes: z.record(Axis, AxisScore),
});

/**
 * PROCESS scoring weights (PROCESS.md §3).
 * potentiel réglementaire 30 %, risque 20 %, timing 20 %,
 * faisabilité foncière 15 %, valeur marché 15 %.
 */
export const PROCESS_WEIGHTS = {
  potentiel: 0.30,
  risque: 0.20,
  timing: 0.20,
  faisabilite: 0.15,
  marche: 0.15,
} as const;

/** Compute the weighted aggregate score from a ScoreSet (result in 0–5 range). */
export const weightedScore = (s: z.infer<typeof ScoreSet>): number =>
  s.potentiel * PROCESS_WEIGHTS.potentiel +
  s.risque * PROCESS_WEIGHTS.risque +
  s.timing * PROCESS_WEIGHTS.timing +
  s.faisabilite * PROCESS_WEIGHTS.faisabilite +
  s.marche * PROCESS_WEIGHTS.marche;

export type EvidenceItemT = z.infer<typeof EvidenceItem>;
export type OpportunityDossierT = z.infer<typeof OpportunityDossier>;
export type VerificationT = z.infer<typeof Verification>;
