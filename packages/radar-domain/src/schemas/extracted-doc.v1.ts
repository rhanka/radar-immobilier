import { z } from "zod";
import { confidenceSchema, isoDateSchema } from "./common.js";

/** Version tag stored alongside every persisted payload of this shape. */
export const EXTRACTED_DOC_SCHEMA_VERSION = "extracted-doc.v1" as const;

/** A single zoning-related mention found in a municipal document. */
export const zoningMentionSchemaV1 = z.object({
  /** Zone code, e.g. "H-113", when stated. */
  zone: z.string().optional(),
  /** Free-text nature of the change ("augmentation de densité", ...). */
  change: z.string(),
  /** Permitted density (units/ha or COS), when stated. */
  density: z.string().optional(),
  /** Max height, when stated. */
  height: z.string().optional(),
  /** Permitted uses mentioned. */
  uses: z.array(z.string()).default([]),
});

/**
 * Normalized output of the LLM extraction over one raw document.
 * Stored in `documents.extracted` (jsonb). Unstable fields stay loose
 * until BR-06 data investigation promotes them.
 */
export const extractedDocSchemaV1 = z.object({
  schemaVersion: z.literal(EXTRACTED_DOC_SCHEMA_VERSION),
  /** Detected document language (ISO 639-1), best-effort. */
  language: z.string().length(2).optional(),
  /** Regulation / file numbers referenced ("Règlement 2024-58", ...). */
  regulationRefs: z.array(z.string()).default([]),
  /** Zoning-related mentions found in the document. */
  zoningMentions: z.array(zoningMentionSchemaV1).default([]),
  /** Key dates extracted from the document. */
  dates: z
    .object({
      adopted: isoDateSchema.optional(),
      effective: isoDateSchema.optional(),
      consultation: isoDateSchema.optional(),
    })
    .default({}),
  /** One-paragraph summary of the document's relevance. */
  summary: z.string(),
  /** Overall confidence of this extraction. */
  confidence: confidenceSchema,
});

export type ZoningMentionV1 = z.infer<typeof zoningMentionSchemaV1>;
export type ExtractedDocV1 = z.infer<typeof extractedDocSchemaV1>;

export const parseExtractedDocV1 = (input: unknown): ExtractedDocV1 =>
  extractedDocSchemaV1.parse(input);
export const safeParseExtractedDocV1 = (input: unknown) =>
  extractedDocSchemaV1.safeParse(input);
