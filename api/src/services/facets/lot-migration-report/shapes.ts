/**
 * Value shape classifiers for the lot-migration report.
 *
 * Prices are validated as exact decimal text over the NUMERIC(14,2)
 * contract (positive, at most two fraction digits); string comparison
 * avoids any floating-point round-trip. URLs satisfy the public HTTP(S)
 * contract. Pipeline rows must not carry market values.
 */

import type {
  DestinationFacet,
  PriceShape,
  UrlShape,
} from "./manifest.js";
import type { SourceMark } from "./types.js";

const MAX_PRICE_INT_DIGITS = 12;
const MAX_URL_LENGTH = 2048;
const MIN_CANONICAL_PRICE = "000000000000.01";
const MAX_CANONICAL_PRICE = "999999999999.99";

export function facetFor(statut: SourceMark["statut"]): DestinationFacet {
  if (statut === "favori") return "selection";
  if (statut === "sollicite" || statut === "lettre_envoyee") return "pipeline";
  if (statut === "en_vente") return "market";
  return "archive";
}

export function priceShapeFor(mark: SourceMark): PriceShape {
  if (mark.prixDemande === null) return "absent";
  if (mark.dimension !== "marche") return "unexpected-on-pipeline";
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(mark.prixDemande)) return "non-canonical";
  const [whole = "", fraction = ""] = mark.prixDemande.split(".");
  if (whole.length > MAX_PRICE_INT_DIGITS) return "non-canonical";
  const padded = `${whole.padStart(MAX_PRICE_INT_DIGITS, "0")}.${(fraction + "00").slice(0, 2)}`;
  if (padded < MIN_CANONICAL_PRICE || padded > MAX_CANONICAL_PRICE) {
    return "non-canonical";
  }
  return "canonical-decimal";
}

export function urlShapeFor(mark: SourceMark): UrlShape {
  if (mark.lienAnnonce === null) return "absent";
  if (
    mark.lienAnnonce.length > 0 &&
    mark.lienAnnonce.length <= MAX_URL_LENGTH &&
    (mark.lienAnnonce.startsWith("http://") ||
      mark.lienAnnonce.startsWith("https://")) &&
    !/\s/.test(mark.lienAnnonce)
  ) {
    try {
      const url = new URL(mark.lienAnnonce);
      if (url.hostname && !url.username && !url.password) return "http-url";
    } catch {
      return "non-http-url";
    }
  }
  return "non-http-url";
}
