/**
 * Human-readable labels for the Steve reason codes (profile
 * immo-steve-2026-09, facet_reason_codes). The API table carries no label,
 * so the UI owns this fr/en dictionary, keyed by code. French first (the
 * app locale); English kept alongside. No new persistence.
 * Sources and validation status: docs/spec/spec-classement-signaux-2026-11-08.md
 * ("Libellés des motifs — à valider par Steve/owner").
 */
export type ReasonLabelLocale = "fr" | "en";

export const REASON_LABELS: Readonly<Record<string, { fr: string; en: string }>> = {
  // Pertinent (P-*)
  "P-VILLE-TERRITOIRE": { fr: "Planification ville et territoire", en: "City and territory planning" },
  "P-NOUV-ZONE": { fr: "Nouvelle zone résidentielle", en: "New residential zone" },
  "P-PERIM-URB": { fr: "Périmètre urbain", en: "Urban perimeter" },
  "P-DENSITE": { fr: "Hausse de densité", en: "Increased density" },
  "P-USAGE-MULTI": { fr: "Multilogement autorisé", en: "Multi-unit housing allowed" },
  "P-TYPO-INTERM": { fr: "Typologie résidentielle intermédiaire", en: "Missing-middle housing" },
  "P-PROJ-INTEGRE": { fr: "Projet intégré résidentiel", en: "Integrated residential project" },
  "P-NORMES": { fr: "Normes assouplies", en: "Relaxed standards" },
  // À surveiller (S-*)
  "S-MANDAT-AMONT": { fr: "Mandat d'urbaniste amont", en: "Early planner mandate" },
  "S-PLANIFIE": { fr: "Changement planifié", en: "Planned change" },
  "S-PORTEE-FLOUE": { fr: "Portée floue", en: "Unclear scope" },
  "S-CONTRAINTE": { fr: "Contrainte à vérifier", en: "Constraint to verify" },
  "S-RESTRICTIF": { fr: "Resserrement à surveiller", en: "Tightening to watch" },
  "S-INFO-MANQUANTE": { fr: "Information manquante", en: "Missing information" },
  "S-PPCMOI-SERIE": { fr: "PPCMOI répétés", en: "Repeated minor exemptions" },
  "S-PREEMPTION": { fr: "Droit de préemption", en: "Right of pre-emption" },
  // Non pertinent (N-*)
  "N-ACCESSOIRE": { fr: "Accessoire sans unités", en: "Accessory, no units" },
  "N-RETIRE": { fr: "Point retiré", en: "Withdrawn item" },
  "N-FORME": { fr: "Forme seulement", en: "Form only" },
  "N-ODJ-SEUL": { fr: "Ordre du jour seulement", en: "Agenda item only" },
  "N-NON-RES": { fr: "Non résidentiel", en: "Non-residential" },
  "N-ADMIN": { fr: "Acte administratif", en: "Administrative act" },
  "N-RESTRICTIF": { fr: "Resserrement", en: "Tightening" },
  "N-UNIFAM": { fr: "Unifamilial seulement", en: "Single-family only" },
  "N-DOUBLON": { fr: "Doublon", en: "Duplicate" },
  "N-HORS-TERR": { fr: "Hors territoire visé", en: "Outside target territory" },
  "N-FAUX-POSITIF": { fr: "Pas un règlement d'urbanisme", en: "Not a planning bylaw" },
  // Hors N-* : codes non_pertinent présents en base hors des 11 N-*.
  "V2-PRECEDENT": { fr: "Autorisation individuelle", en: "Individual authorization" },
  "legacy-unknown": { fr: "Motif hérité inconnu", en: "Legacy unknown reason" },
};

/** Dictionary label for a code; falls back to the technical code itself. */
export function reasonLabel(code: string, locale: ReasonLabelLocale = "fr"): string {
  return REASON_LABELS[code]?.[locale] ?? code;
}

/**
 * Label for a reason-code entry: UI dictionary first, then a
 * server-provided label (codes outside the dictionary, e.g. V2-*),
 * then the technical code.
 */
export function reasonEntryLabel(
  entry: { code: string; label?: string | null },
  locale: ReasonLabelLocale = "fr",
): string {
  const fromDictionary = REASON_LABELS[entry.code]?.[locale];
  if (fromDictionary) return fromDictionary;
  const serverLabel = entry.label?.trim();
  return serverLabel ? serverLabel : entry.code;
}
