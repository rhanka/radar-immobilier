import { cityMaturity, type ScrapeStatusT } from "@radar/domain";

export type MaturityColor = "slate" | "red" | "amber" | "teal" | "green";

/**
 * Map a 0–100 maturity score to a Tailwind color name used for city dots.
 * Mirrors the 4-tier system used in the city detail panel.
 */
export function cityMaturityColor(maturity: number): MaturityColor {
  if (maturity === 0) return "slate";
  if (maturity < 25) return "red";
  if (maturity < 50) return "amber";
  if (maturity < 100) return "teal";
  return "green";
}

/** Human-readable tier label for the maturity percentage. */
export function maturityLabel(maturity: number): string {
  if (maturity === 0) return "Aucune donnée";
  if (maturity < 25) return "Démarrage";
  if (maturity < 50) return "Partiel";
  if (maturity < 100) return "Avancé";
  return "Complet";
}

/** Aggregated city-level maturity summary. */
export interface CityMaturitySummary {
  citySlug: string;
  maturity: number;
  color: MaturityColor;
  items: ScrapeStatusT[];
}

/**
 * Group a flat list of ScrapeStatus records by city and compute each city's
 * maturity score. Returns one entry per unique citySlug, sorted by slug.
 */
export function groupByCity(items: ScrapeStatusT[]): CityMaturitySummary[] {
  const byCity = new Map<string, ScrapeStatusT[]>();
  for (const item of items) {
    const existing = byCity.get(item.citySlug) ?? [];
    byCity.set(item.citySlug, [...existing, item]);
  }
  return Array.from(byCity.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([citySlug, cityItems]) => {
      const maturity = cityMaturity(cityItems);
      return {
        citySlug,
        maturity,
        color: cityMaturityColor(maturity),
        items: cityItems,
      };
    });
}
