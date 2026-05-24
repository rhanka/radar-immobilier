import { z } from "zod";
import { confidenceSchema, evidenceSchema } from "./common.js";

export const SIGNAL_PAYLOAD_SCHEMA_VERSION = "signal-payload.v1" as const;

/** Kinds of regulatory signal the radar detects (VISION §6, PROCESS §1). */
export const signalKindSchema = z.enum([
  "zoning-change", // PRIORITÉ 1 — changement de zonage résidentiel
  "ppcmoi", // PRIORITÉ 2 — projet particulier (exception)
  "minor-derogation", // PRIORITÉ 3 — dérogation mineure pertinente
  "cptaq", // PRIORITÉ 4 — dézonage agricole
  "public-notice", // avis public générique
  "council-intent", // intention politique (PV)
  "other",
]);

/**
 * Structured payload attached to a detected signal. Stored in
 * `signals.payload` (jsonb).
 */
export const signalPayloadSchemaV1 = z.object({
  schemaVersion: z.literal(SIGNAL_PAYLOAD_SCHEMA_VERSION),
  kind: signalKindSchema,
  /** Regulation / file references tying this signal to documents. */
  regulationRefs: z.array(z.string()).default([]),
  /** Affected zone codes, when known. */
  zones: z.array(z.string()).default([]),
  /** Short human-readable description of the signal. */
  summary: z.string(),
  /** Evidence backing the detection. */
  evidence: z.array(evidenceSchema).min(1),
  /** Detection confidence. */
  confidence: confidenceSchema,
});

export type SignalKind = z.infer<typeof signalKindSchema>;
export type SignalPayloadV1 = z.infer<typeof signalPayloadSchemaV1>;

export const parseSignalPayloadV1 = (input: unknown): SignalPayloadV1 =>
  signalPayloadSchemaV1.parse(input);
export const safeParseSignalPayloadV1 = (input: unknown) =>
  signalPayloadSchemaV1.safeParse(input);
