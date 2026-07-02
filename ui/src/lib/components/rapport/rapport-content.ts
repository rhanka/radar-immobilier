// Contenu du rapport d'étude compilé dans le bundle au build (imports
// statiques Vite `?raw`). Source unique de vérité :
// docs/spec/reports/study-2026-07/ — aucune copie du contenu n'est maintenue
// côté UI, la vue rend exactement le document livré.
import reportRaw from "../../../../../docs/spec/reports/study-2026-07/report.md?raw";
import slidesRaw from "../../../../../docs/spec/reports/study-2026-07/slides.html?raw";

/**
 * Retire les images locales du rapport (chemins `assets/…` relatifs au dossier
 * docs, non empaquetés dans le bundle de l'app). Les légendes textuelles qui
 * suivent les images sont conservées : elles décrivent la vue sans dépendre du
 * binaire de la capture.
 */
export function stripLocalImages(markdown: string): string {
  return markdown
    .replace(/^!\[[^\]]*\]\((?:\.\/)?assets\/[^)]+\)\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n");
}

/** Extrait la date d'édition (`Date : YYYY-MM-DD`) de l'en-tête du rapport. */
export function extractReportDate(markdown: string): string | null {
  const match = markdown.match(/^Date\s*:\s*(\d{4}-\d{2}-\d{2})/m);
  return match ? match[1] : null;
}

/** Markdown du rapport, prêt à rendre (images locales retirées). */
export const RAPPORT_MARKDOWN: string = stripLocalImages(reportRaw);

/** Date d'édition affichée dans l'en-tête de la vue. */
export const RAPPORT_DATE: string | null = extractReportDate(reportRaw);

/** HTML autonome des slides (même dossier source), ouvert via un blob URL. */
export const SLIDES_HTML: string = slidesRaw;
