/** Regulation provenance fields recognized on live geo zone properties. */
export const REGLEMENT_KEYS = [
  "reglement_numero",
  "reglement_millesime",
  "reglement_page_source",
  "reglement_url",
  "reglementNumero",
  "reglementMillesime",
  "reglementPageSource",
  "reglementUrl",
  "REGLEMENT_NUMERO",
  "REGLEMENT_MILLESIME",
  "REGLEMENT_PAGE_SOURCE",
  "REGLEMENT_URL",
] as const;

/** Explicit normative value fields recognized on live geo zone properties. */
export const NORMATIVE_VALUE_KEYS = [
  "densite_value",
  "hauteur_min_value",
  "hauteur_max_value",
  "frontage_min_value",
  "superficie_min_value",
  "marge_avant_min_value",
  "marge_laterale_min_value",
  "marge_arriere_min_value",
] as const;

/** Normalize sourced evidence verbatim-or-null, without deriving semantics. */
export function normalizeNormValue(value: unknown): string | number | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const normalized = normalizeNormValue(item);
      if (normalized !== null) return normalized;
    }
    return null;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const numeric = Number(trimmed.replace(",", "."));
  return Number.isFinite(numeric) ? numeric : trimmed;
}

export function hasRecognizedValue(
  props: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return keys.some((key) => normalizeNormValue(props[key]) !== null);
}
