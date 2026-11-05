/**
 * Dated per-collection records for the city zoning collections served through
 * the closed zoning projection (J1 zonage, field review j1-2b §7.4 exit).
 *
 * One line per `qc-zonage-<city>` collection, observed on the live public OGC
 * API on 2026-11-05:
 * - licence: exact `license.title` of the `/collections` listing, resolved by
 *   the governed registry (three known titles, no normalisation);
 * - source keys: union of property keys over the first <= 200 items of the
 *   collection, intersected with the keys the UI zoning layer reads
 *   (`ZONING_SOURCE_KEY_UNIVERSE`) plus the two provenance envelopes. Every
 *   other raw key (ArcGIS ids, densities, `zone_source_url`, `source`,
 *   `confidence`, …) is never read;
 * - served fields: the closed projection (`ZONING_PROJECTION_FIELDS`), all
 *   public municipal zoning attributes (Loi 25 class `public`): zone code,
 *   family, land-use label, usages, by-law vintage and number, and public
 *   canonical by-law/grid links only.
 *
 * A record is NECESSARY, not sufficient: the catalogue still requires, at
 * every read, the live licence title to resolve to the recorded id AND the
 * live `rights` object to be present (governed-policy.ts, condition iii). On
 * the 2026-11-05 observation NONE of these 68 city collections renders
 * `rights`, so each one is refused `not covered` / `rights-missing` until geo
 * renders it. This file does not lower that rule.
 */

import { GOVERNED_LICENCE_REGISTRY } from "./governed-licences.js";
import type { ServedCollectionRecord } from "./governed-policy.js";
import { ZONING_PROJECTION, ZONING_PROJECTION_FIELDS } from "./zoning-projection.js";

export const ZONING_RECORDS_OBSERVED_AT = "2026-11-05";
export const ZONING_RECORDS_SOURCE = "live-observation-public-ogc-api-items-limit-200-key-union";

function zoning(collectionId: string, licenseId: string, sourceKeys: readonly string[]): ServedCollectionRecord {
  const licence = GOVERNED_LICENCE_REGISTRY.find((entry) => entry.id === licenseId);
  if (!licence) throw new Error(`zoning record ${collectionId}: licence ${licenseId} not in registry`);
  return {
    collectionId,
    matchedTitle: licence.title,
    licenseId,
    loi25Class: "public",
    servedFields: ZONING_PROJECTION_FIELDS,
    observedAt: ZONING_RECORDS_OBSERVED_AT,
    source: ZONING_RECORDS_SOURCE,
    zoning: { projection: ZONING_PROJECTION, sourceKeys },
  };
}

export const GOVERNED_ZONING_RECORDS: readonly ServedCollectionRecord[] = [
  zoning("qc-zonage-barnston-ouest", "cc-by-4.0", ["ETIQUETTE", "Grille", "ZONE", "affectation", "kind", "num_zone", "proof", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-beaupre", "cc-by-4.0", ["affectation", "kind", "num_zone", "proof", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-brownsburg-chatham", "cc-by-4.0", ["reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-chambly", "cc-by-4.0", ["LienGrille", "NumZone", "affectation", "kind", "num_zone", "proof", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-charlemagne", "cc-by-4.0", ["ZONE", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-coaticook", "cc-by-4.0", ["ETIQUETTE", "Grille", "ZONE", "affectation", "kind", "num_zone", "proof", "zone_code"]),
  zoning("qc-zonage-compton", "cc-by-4.0", ["ETIQUETTE", "Grille", "ZONE", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-cote-saint-luc", "cc-by-4.0", ["Zonage", "code", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-dixville", "cc-by-4.0", ["ETIQUETTE", "Grille", "ZONE", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-dorval", "cc-by-4.0", ["NUM_ZONE", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-east-hereford", "cc-by-4.0", ["ETIQUETTE", "Grille", "ZONE", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-gore", "cc-by-4.0", ["reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-grenville", "cc-by-4.0", ["reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-grenville-sur-la-rouge", "cc-by-4.0", ["reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-hampstead", "cc-by-4.0", ["Zone", "affectation", "kind", "num_zone", "proof", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-harrington", "cc-by-4.0", ["reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-honfleur", "cc-by-4.0", ["affectation", "kind", "num_zone", "proof", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-l-assomption", "cc-by-4.0", ["ZONE", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-l-epiphanie", "cc-by-4.0", ["ZONE", "zone_code"]),
  zoning("qc-zonage-la-durantaye", "cc-by-4.0", ["affectation", "kind", "num_zone", "proof", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-la-presentation", "cc-by-4.0", ["Affectation", "Zone", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-lachute", "cc-by-4.0", ["reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-longueuil", "cc-by-4.0", ["URL_Grille", "Zonage", "affectation", "kind", "num_zone", "proof", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-martinville", "cc-by-4.0", ["ETIQUETTE", "Grille", "ZONE", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-mille-isles", "cc-by-4.0", ["affectation", "kind", "num_zone", "proof", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-mont-saint-hilaire", "cc-by-4.0", ["affectation", "kind", "num_zone", "proof", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-neuville", "portneuf-zonage-municipal", ["kind", "proof", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-notre-dame-auxiliatrice-de-buckland", "cc-by-4.0", ["affectation", "kind", "num_zone", "proof", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-otterburn-park", "cc-by-4.0", ["Affectation", "Zone", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-rosemere", "rosemere-zonage-municipal", ["kind", "proof", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-saint-andre-dargenteuil", "cc-by-4.0", ["reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-saint-barnabe-sud", "cc-by-4.0", ["Affectation", "Zone", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-saint-bernard-de-michaudville", "cc-by-4.0", ["Affectation", "Zone", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-saint-charles-de-bellechasse", "cc-by-4.0", ["affectation", "kind", "num_zone", "proof", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-saint-charles-sur-richelieu", "cc-by-4.0", ["Affectation", "Zone", "affectation", "kind", "num_zone", "proof", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-saint-damien-de-buckland", "cc-by-4.0", ["affectation", "kind", "num_zone", "proof", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-saint-denis-sur-richelieu", "cc-by-4.0", ["Affectation", "Zone", "affectation", "kind", "num_zone", "proof", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-saint-ferreol-les-neiges", "cc-by-4.0", ["Zone", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-saint-gervais", "cc-by-4.0", ["affectation", "kind", "num_zone", "proof", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-saint-gilbert", "portneuf-zonage-municipal", ["kind", "proof", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-saint-hermenegilde", "cc-by-4.0", ["ETIQUETTE", "Grille", "ZONE", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-saint-hyacinthe", "cc-by-4.0", ["ETIQUETTE", "GRILLE_URL", "NUM_ZONE"]),
  zoning("qc-zonage-saint-jean-baptiste", "cc-by-4.0", ["affectation", "kind", "num_zone", "proof", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-saint-joachim", "cc-by-4.0", ["Zone", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-saint-jude", "cc-by-4.0", ["Affectation", "Zone", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-saint-lazare-de-bellechasse", "cc-by-4.0", ["affectation", "kind", "num_zone", "proof", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-saint-louis", "cc-by-4.0", ["Affectation", "Zone", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-saint-louis-de-gonzague-du-cap-tourmente", "cc-by-4.0", ["Zone", "zone_code"]),
  zoning("qc-zonage-saint-malachie", "cc-by-4.0", ["affectation", "code", "no_zone", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-saint-malo", "cc-by-4.0", ["ETIQUETTE", "Grille", "ZONE", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-saint-marcel-de-richelieu", "cc-by-4.0", ["Affectation", "Zone", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-saint-mathias-sur-richelieu", "cc-by-4.0", ["Affectation", "Zone", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-saint-michel-de-bellechasse", "cc-by-4.0", ["affectation", "code", "no_zone", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-saint-neree-de-bellechasse", "cc-by-4.0", ["affectation", "code", "no_zone", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-saint-philemon", "cc-by-4.0", ["affectation", "kind", "num_zone", "proof", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-saint-raphael", "cc-by-4.0", ["affectation", "kind", "num_zone", "proof", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-saint-sulpice", "cc-by-4.0", ["ZONE", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-saint-vallier", "cc-by-4.0", ["affectation", "code", "no_zone", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-saint-venant-de-paquette", "cc-by-4.0", ["ETIQUETTE", "Grille", "ZONE", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-sainte-anne-de-beaupre", "cc-by-4.0", ["affectation", "kind", "num_zone", "proof", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-sainte-claire", "cc-by-4.0", ["affectation", "code", "no_zone", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-sainte-edwidge-de-clifton", "cc-by-4.0", ["ETIQUETTE", "Grille", "ZONE", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-sainte-madeleine", "cc-by-4.0", ["Affectation", "Zone", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-sainte-marie-madeleine", "cc-by-4.0", ["Affectation", "Zone", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-stanstead-est", "cc-by-4.0", ["ETIQUETTE", "Grille", "ZONE", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-waterville", "cc-by-4.0", ["ETIQUETTE", "Grille", "ZONE", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-wentworth", "cc-by-4.0", ["reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
  zoning("qc-zonage-westmount", "cc-by-4.0", ["affectation", "kind", "num_zone", "proof", "reglement_millesime", "reglement_numero", "reglement_url", "zone_code"]),
];
