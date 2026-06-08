import { z } from "zod";

/**
 * Pure parser for the Salaberry-de-Valleyfield "Avis publics" index page —
 * the proven ÉV11 parser, promoted out of the API automation service into the
 * sources package so the RECUEIL SourceAdapter and the legacy automation
 * connector share ONE implementation (No Legacy Fallback: no duplicate logic).
 *
 * The page is plain public HTML (Craft CMS) listing notices as anchors that
 * link to public PDFs:
 *
 *   <a class="icon-block icon-block--is-link" href="...notice.pdf" download>
 *     ...
 *     <div class="icon-block__title">Dérogations mineures du 20 mai 2026</div>
 *     <div class="icon-block__text icon-block__date">20 mai 2026</div>
 *   </a>
 *
 * Nothing is fabricated: a field absent from the page becomes "non-disponible".
 */

export const AVIS_PUBLICS_SOURCE_URL =
  "https://www.ville.valleyfield.qc.ca/avis-publics";

/** Placeholder used wherever a field cannot be extracted (anti-invention). */
export const NON_DISPONIBLE = "non-disponible";

/** Notice kinds we can infer from the title / filename (Québec municipal). */
export const AvisType = z.enum([
  "derogation-mineure",
  "ppcmoi",
  "consultation",
  "registre-referendaire",
  "entree-en-vigueur",
  "projet-reglement",
  "alienation",
  "vente-pour-taxes",
  "autre",
]);
export type AvisTypeT = z.infer<typeof AvisType>;

export const AvisPublicItem = z.object({
  /** Human-readable notice title, verbatim from the page. */
  title: z.string().min(1),
  /** Notice date as displayed on the page (e.g. "20 mai 2026"), or NON_DISPONIBLE. */
  dateLabel: z.string().min(1),
  /** ISO date (YYYY-MM-DD) parsed from dateLabel when possible, else NON_DISPONIBLE. */
  dateIso: z.string().min(1),
  /** Absolute URL of the notice PDF. */
  url: z.string().url(),
  /** Inferred notice kind. */
  type: AvisType,
  /** Bylaw / file references found in the title (e.g. "150-49"), if any. */
  bylaws: z.array(z.string()).default([]),
});
export type AvisPublicItemT = z.infer<typeof AvisPublicItem>;

const FRENCH_MONTHS: Record<string, string> = {
  janvier: "01", février: "02", fevrier: "02", mars: "03", avril: "04",
  mai: "05", juin: "06", juillet: "07", août: "08", aout: "08",
  septembre: "09", octobre: "10", novembre: "11", décembre: "12", decembre: "12",
};

/** Decode the small set of HTML entities the source emits in titles. */
function decodeEntities(raw: string): string {
  return raw
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&laquo;/g, "«")
    .replace(/&raquo;/g, "»")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&eacute;/g, "é")
    .replace(/&egrave;/g, "è")
    .replace(/&agrave;/g, "à")
    .replace(/\s+/g, " ")
    .trim();
}

/** "20 mai 2026" -> "2026-05-20". Returns NON_DISPONIBLE when unparseable. */
export function frenchDateToIso(label: string): string {
  const m = label
    .trim()
    .toLowerCase()
    .match(/^(\d{1,2})\s+([a-zàâçéèêëîïôûù]+)\s+(\d{4})$/i);
  if (!m || !m[1] || !m[2] || !m[3]) return NON_DISPONIBLE;
  const day = m[1].padStart(2, "0");
  const month = FRENCH_MONTHS[m[2]];
  if (!month) return NON_DISPONIBLE;
  return `${m[3]}-${month}-${day}`;
}

/** Infer notice kind from the title (best-effort, never invented). */
export function inferAvisType(title: string): AvisTypeT {
  const t = title.toLowerCase();
  if (t.includes("dérogation") || t.includes("derogation")) return "derogation-mineure";
  if (t.includes("ppcmoi")) return "ppcmoi";
  if (t.includes("registre") || t.includes("référendaire") || t.includes("referendaire"))
    return "registre-referendaire";
  if (t.includes("consultation")) return "consultation";
  if (t.includes("entrée en vigueur") || t.includes("entree en vigueur")) return "entree-en-vigueur";
  if (t.includes("projet") && t.includes("règlement")) return "projet-reglement";
  if (t.includes("projet de règlement") || t.includes("projet de reglement")) return "projet-reglement";
  if (t.includes("aliénation") || t.includes("alienation")) return "alienation";
  if (t.includes("vente pour") || t.includes("défaut de paiement") || t.includes("defaut de paiement"))
    return "vente-pour-taxes";
  return "autre";
}

/** Extract bylaw references such as "150-49", "209-47", "476". */
export function extractBylaws(title: string): string[] {
  const matches = title.match(/\b\d{2,3}-\d{1,3}\b/g) ?? [];
  return Array.from(new Set(matches));
}

/**
 * Parse the avis-publics HTML into structured items. Tolerant of attribute
 * order; relies on the stable `icon-block` anchor + title/date sub-divs.
 */
export function parseAvisPublics(html: string): AvisPublicItemT[] {
  const items: AvisPublicItemT[] = [];
  // Each notice is one anchor with class "icon-block icon-block--is-link".
  const anchorRe =
    /<a\b[^>]*class="[^"]*icon-block--is-link[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const anchor of html.matchAll(anchorRe)) {
    const block = anchor[0];
    const inner = anchor[1] ?? "";

    const hrefMatch = block.match(/href="([^"]+)"/i);
    const url = hrefMatch?.[1] ? hrefMatch[1].trim() : "";
    if (!/^https?:\/\//i.test(url)) continue;

    const titleMatch = inner.match(
      /class="[^"]*icon-block__title[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    );
    const title = titleMatch?.[1] ? decodeEntities(titleMatch[1]) : "";
    if (!title) continue;

    const dateMatch = inner.match(
      /class="[^"]*icon-block__date[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    );
    const dateLabel = dateMatch?.[1] ? decodeEntities(dateMatch[1]) : NON_DISPONIBLE;
    const dateIso = dateLabel === NON_DISPONIBLE ? NON_DISPONIBLE : frenchDateToIso(dateLabel);

    const parsed = AvisPublicItem.safeParse({
      title,
      dateLabel: dateLabel || NON_DISPONIBLE,
      dateIso,
      url,
      type: inferAvisType(title),
      bylaws: extractBylaws(title),
    });
    if (parsed.success) items.push(parsed.data);
  }
  return items;
}
