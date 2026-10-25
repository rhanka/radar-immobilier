import { z } from "zod";
import type { GraphSignalCard } from "../../routes/graph-signals.js";
import { Stage } from "./classification-query.js";

export const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((day) => {
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day;
});
const date = z.union([Day, z.string().datetime({ offset: true })]);
const url = z.string().max(8192).url().refine((value) => {
  const parsed = new URL(value);
  return ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password;
});
const fields = z.enum(["label", "description", "sourceStage", "docRefs", "docRefs.title", "docRefs.excerpt"]);
export const SignalCard = z.object({ label: z.string().max(1024), description: z.string().max(8000).nullable(),
  stage: Stage, sourceStage: z.string().max(256).nullable(), regulatoryStatus: z.enum(["firm", "anticipation"]),
  freshness: z.object({ day: Day.nullable(), basis: z.enum(["document", "scrap"]) }).strict(),
  automaticExclusionReason: z.enum(["piia_non_pertinent", "derogation_hors_sujet", "non_residentiel_franc", "hors_zonage"]).nullable(),
  docRefs: z.array(z.object({ docSha: z.string().min(1), sourceUrl: url.nullable(), documentUrl: url.nullable(),
    title: z.string().max(1024).nullable(), publishedAt: date.nullable(), fetchedAt: date.nullable(),
    page: z.number().int().positive().nullable(), excerpt: z.string().max(2000).nullable(),
    provisional: z.boolean().nullable() }).strict()).max(64),
  missingEvidence: z.array(z.enum(["description", "citation", "pdfLink", "documentDate", "page", "bbox"])),
  truncatedFields: z.array(fields),
}).strict();

export function publicDocumentUrl(value: unknown, apiOrigin?: string): string | null {
  if (typeof value !== "string" || value.length > 8192) return null;
  let candidate = value;
  if (value.startsWith("/api/documents/raw?")) {
    if (!apiOrigin) return null;
    const origin = url.safeParse(apiOrigin);
    if (!origin.success) return null;
    candidate = new URL(value, new URL(origin.data).origin).href;
  }
  return url.safeParse(candidate).success ? candidate : null;
}
function validDate(value: unknown): string | null {
  const parsed = date.safeParse(value);
  if (!parsed.success || !Day.safeParse(parsed.data.slice(0, 10)).success) return null;
  return parsed.data;
}
export function projectSignalCard(card: GraphSignalCard, day: string | null, apiOrigin?: string) {
  const truncated = new Set<z.infer<typeof fields>>();
  const text = (value: string | null | undefined, maximum: number, field: z.infer<typeof fields>) => {
    if (value == null) return null;
    if (value.length <= maximum) return value;
    truncated.add(field);
    const cut = value.slice(0, maximum);
    return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
  };
  if (card.docRefs.length > 64) truncated.add("docRefs");
  const docRefs = card.docRefs.slice(0, 64).map((ref) => ({ docSha: ref.docSha,
    sourceUrl: publicDocumentUrl(ref.sourceUrl, apiOrigin), documentUrl: publicDocumentUrl(ref.documentUrl, apiOrigin),
    title: text(ref.title, 1024, "docRefs.title"), publishedAt: validDate(ref.publishedAt), fetchedAt: validDate(ref.fetchedAt),
    page: Number.isInteger(ref.page) && ref.page! > 0 ? ref.page! : null,
    excerpt: text(ref.excerpt, 2000, "docRefs.excerpt"), provisional: ref.provisional ?? null,
  }));
  const description = text(card.description, 8000, "description");
  const evidence = { description: !!description, citation: docRefs.some((ref) => !!ref.excerpt),
    pdfLink: docRefs.some((ref) => !!ref.documentUrl), documentDate: docRefs.some((ref) => !!ref.publishedAt),
    page: docRefs.some((ref) => ref.page !== null), bbox: card.evidence.completeness.hasBbox };
  const missingEvidence = (Object.keys(evidence) as Array<keyof typeof evidence>).filter((key) => !evidence[key]);
  return SignalCard.parse({ label: text(card.label, 1024, "label"), description,
    stage: card.classification.etape, sourceStage: text(card.etape, 256, "sourceStage"),
    regulatoryStatus: card.regulatoryStatus, freshness: { day, basis: "document" },
    automaticExclusionReason: card.classification.exclusion_reason, docRefs, missingEvidence,
    truncatedFields: [...truncated],
  });
}
