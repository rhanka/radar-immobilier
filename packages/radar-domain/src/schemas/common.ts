import { z } from "zod";

/** Real vs simulation discriminator (pipeline-internal flag; English for infra/config interop). */
export const Mode = z.enum(["real", "simulation"]);

/** Qualitative confidence level used across evidence, scoring, and axis assessments. */
export const Confidence = z.enum(["high", "medium", "low"]);
export type ConfidenceT = z.infer<typeof Confidence>;
export type ModeT = z.infer<typeof Mode>;

/** Extraction / detection confidence, 0 (none) to 1 (certain). */
export const confidenceSchema = z.number().min(0).max(1);

/** ISO-8601 datetime string. */
export const isoDateTimeSchema = z.string().datetime();

/** ISO-8601 date string (no time component), e.g. "2024-05-18". */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

/**
 * A pointer to the evidence backing a value (a score, a signal, an
 * extracted field). Every decision-grade value must carry one
 * (rules/scoring.md, rules/MASTER.md storage policy).
 */
export const evidenceSchema = z.object({
  /** Object-storage key of the raw source document. */
  s3Key: z.string().min(1),
  /** Page number for PDFs (1-based), when applicable. */
  page: z.number().int().positive().optional(),
  /** Verbatim excerpt supporting the value (<= 500 chars). */
  excerpt: z.string().max(500),
  /** Confidence of the extraction that produced this evidence. */
  confidence: confidenceSchema,
  /** When the evidence was captured. */
  capturedAt: isoDateTimeSchema,
});

export type ConfidenceScore = z.infer<typeof confidenceSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
