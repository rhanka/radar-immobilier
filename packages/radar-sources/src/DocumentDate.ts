import { z } from "zod";

import { extractIsoFromLabel, isRealIsoDate } from "./sources/proces-verbaux-parser.js";

export function isDocumentDateValue(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value) || isRealIsoDate(value)
    || (isRealIsoDate(value.slice(0, 10))
      && z.string().datetime({ offset: true }).safeParse(value).success);
}

const evidence = z.object({ page: z.number().int().positive().optional(),
  excerpt: z.string().min(1).optional(), field: z.string().min(1).optional() }).strict();
export const DocumentDateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("known"), value: z.string().refine(isDocumentDateValue),
    precision: z.enum(["day", "month"]), kind: z.enum(["session", "publication", "document"]),
    method: z.enum(["listing", "header", "manifest", "signal-llm"]), evidence }).strict(),
  z.object({ status: z.literal("unknown"), reason: z.string().optional() }).strict(),
  z.object({ status: z.literal("ambiguous"), candidates: z.array(z.string().refine(isDocumentDateValue))
    .min(2), reason: z.string() }).strict(),
]).refine((date) => date.status !== "known"
  || (date.precision === "month") === /^\d{4}-\d{2}$/.test(date.value),
"Date precision must match its value");
export type DocumentDate = z.infer<typeof DocumentDateSchema>;

export function documentDateFromPublishedAt(value: unknown,
  method: "listing" | "manifest" = "listing", kind: "session" | "publication" | "document" = "document"):
DocumentDate {
  if (typeof value !== "string" || !isDocumentDateValue(value)) return { status: "unknown" };
  return { status: "known", value, precision: value.length === 7 ? "month" : "day", kind,
    method, evidence: { field: "publishedAt" } };
}

/** Only a bounded first-page header is a documentary-date surface, never the body. */
export function documentDateHeader(text: string): string {
  return (text.split("\f")[0] ?? "").slice(0, 4000)
    .split(/^\s*(?:[IVX]+\.\s|NOTE\s+\d+\s*:)/im)[0] ?? "";
}

export function extractDocumentHeaderDate(text: string): DocumentDate {
  const header = documentDateHeader(text);
  const dates = new Map<string, string>();
  const pattern = /(?<!\d)\d{1,2}(?:er)?\s+[a-zàâçéèêëîïôûù]+\s+20\d{2}(?!\d)|(?<!\d)20\d{2}[-/]\d{2}[-/]\d{2}(?!\d)/gi;
  for (const match of header.matchAll(pattern)) {
    const excerpt = header.slice(Math.max(0, match.index - 140), match.index + match[0].length + 140).trim();
    if (!/s[ée]ance|conseil|ordre\s+du\s+jour|proc[èe]s\s*-?\s*verbal/i.test(excerpt)) continue;
    const value = extractIsoFromLabel(match[0]);
    if (isRealIsoDate(value)) dates.set(value, excerpt);
  }
  if (dates.size > 1) return { status: "ambiguous", candidates: [...dates.keys()].sort(),
    reason: "Conflicting session dates in the document header" };
  const candidate = [...dates.entries()][0];
  return candidate ? { status: "known", value: candidate[0], precision: "day", kind: "session",
    method: "header", evidence: { page: 1, excerpt: candidate[1] } } : { status: "unknown" };
}

/** Explicit metadata wins; legacy metadata is interpreted once and never changes clocks. */
export function resolveDocumentDate(metadata: { documentDate?: unknown; publishedAt?: unknown }): DocumentDate {
  const parsed = DocumentDateSchema.safeParse(metadata.documentDate);
  if (!parsed.success) return documentDateFromPublishedAt(metadata.publishedAt);
  if (parsed.data.status === "known" && metadata.publishedAt !== undefined
    && metadata.publishedAt !== parsed.data.value) {
    const legacy = documentDateFromPublishedAt(metadata.publishedAt);
    if (legacy.status === "known") return { status: "ambiguous",
      candidates: [parsed.data.value, legacy.value], reason: "Contradictory persisted documentary dates" };
  }
  return parsed.data;
}
