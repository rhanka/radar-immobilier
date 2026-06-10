/**
 * Dérivation statique du ScrapeStatus réel par ville×source.
 *
 * Cette fonction construit la liste des ScrapeStatus à partir des sources de vérité
 * statiques (ALL_PV_CITIES, SEED_CITY_SLUGS, GeoSourceInventory) — sans inventer.
 *
 * Règles anti-invention (MASTER.md §0.2) :
 *   - status "scraped" ⟺ le fixture PV existe dans ALL_PV_CITIES (texte réel).
 *   - status "graphified" ⟺ déclaré uniquement pour les villes MAMH dont le
 *     seed-ontology a été exécuté et produit un project-state.
 *   - status "identified" ⟺ URL ou config connue mais aucune ingestion vérifiée.
 *   - status "todo" ⟺ source prévue mais non encore identifiée.
 *   - dataQuality = "pdf" pour les PV (toujours PDF sauf exception notée).
 *   - dataQuality = "geojson" quand GeoSourceInventory confirme une source vecteur.
 *
 * @module
 */

import { ALL_PV_CITIES, getGeoSourceInventory } from "@radar/sources";
import { SEED_CITY_SLUGS } from "../sources/seed-ontology.js";
import type { ScrapeStatusT } from "@radar/domain";

// ─────────────────────────────────────────────────────────────────────────────
// Statuts dérivés pour les villes MAMH (valleyfield, beauharnois)
// ─────────────────────────────────────────────────────────────────────────────

/** Sources connues pour les villes MAMH pilotes. */
interface MamhCitySource {
  citySlug: string;
  /** Source "avis-publics" : status = graphified (seed-ontology exploite les avis). */
  avisPublics: { siteUrl: string };
  /** Source "role-evaluation" : status = graphified (seed-ontology exploite le rôle). */
  roleEvaluation: { siteUrl: string };
  /** Source "zonage" : derived from GeoSourceInventory. */
}

const MAMH_CITIES: MamhCitySource[] = [
  {
    citySlug: "salaberry-de-valleyfield",
    avisPublics: { siteUrl: "https://ville.valleyfield.qc.ca/avis-publics" },
    roleEvaluation: {
      siteUrl: "https://www.donneesquebec.ca/recherche/dataset/role-evaluation-fonciere",
    },
  },
  {
    citySlug: "beauharnois",
    avisPublics: { siteUrl: "https://ville.beauharnois.qc.ca/avis-publics" },
    roleEvaluation: {
      siteUrl: "https://www.donneesquebec.ca/recherche/dataset/role-evaluation-fonciere",
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Fonction de dérivation statique
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Construit la liste ScrapeStatus dérivée statiquement des sources de vérité.
 *
 * - Pour chaque ville dans ALL_PV_CITIES : source "conseils-municipaux",
 *   status "scraped" (fixture PV réelle présente), dataQuality "pdf",
 *   automation "one_shot", windowMonths 6.
 *
 * - Pour chaque ville MAMH (valleyfield, beauharnois) :
 *   - "avis-publics" → graphified (seed-ontology exploite les avis)
 *   - "role-evaluation" → graphified (seed-ontology exploite le rôle)
 *   - "zonage" → status dérivé de GeoSourceInventory (identified si URL connue)
 *
 * La liste est stable et déterministe — pas de réseaux, pas de store.
 * Les enregistrements peuvent être surchargés par PUT /api/scrape-status
 * (agents de recueil peuvent upgrader le statut en "graphified" après ingestion).
 */
export function deriveStaticScrapeStatuses(): ScrapeStatusT[] {
  const records: ScrapeStatusT[] = [];

  // ── 1. Villes PV génériques (ALL_PV_CITIES) ──────────────────────────────
  for (const city of ALL_PV_CITIES) {
    const { citySlug, sourceId, pvIndexUrl } = city.config;
    records.push({
      citySlug,
      source: "conseils-municipaux",
      automation: "one_shot",
      windowMonths: 6,
      // "scraped" : le texte fixture existe (vraie extraction pdftotext capturée).
      // Le statut peut être upgradé en "graphified" après exploitation.
      status: "scraped",
      dataQuality: "pdf",
      siteUrl: pvIndexUrl,
      notes: `Fixture PV réelle présente (${sourceId}). Texte pdftotext capturé 2026-06.`,
    });
  }

  // ── 2. Villes MAMH (valleyfield, beauharnois) ─────────────────────────────
  for (const mamh of MAMH_CITIES) {
    const { citySlug } = mamh;
    const isSeeded = (SEED_CITY_SLUGS as readonly string[]).includes(citySlug);

    // Source avis-publics
    records.push({
      citySlug,
      source: "avis-publics",
      automation: "refresh",
      windowMonths: 6,
      // graphified si seed-ontology a été exécuté (SEED_CITY_SLUGS = villes seedées)
      status: isSeeded ? "graphified" : "scraped",
      dataQuality: "html",
      siteUrl: mamh.avisPublics.siteUrl,
      notes: isSeeded
        ? "Seed-ontology exécuté : exploitation avis + rôle + adresses."
        : "Config connue, pas encore seedée.",
    });

    // Source role-evaluation
    records.push({
      citySlug,
      source: "role-evaluation",
      automation: "one_shot",
      windowMonths: 6,
      status: isSeeded ? "graphified" : "identified",
      dataQuality: "html",
      siteUrl: mamh.roleEvaluation.siteUrl,
      notes: isSeeded
        ? "Rôle MAMH XML ingéré + exploité par seed-ontology."
        : "Données Québec CKAN identifiées, pas encore ingérées.",
    });

    // Source zonage — dérivé de GeoSourceInventory
    const geo = getGeoSourceInventory(citySlug);
    if (geo) {
      const zonageStatus = deriveZonageStatus(geo.zonage.availability, geo.zonage.url);
      const zonageQuality = geo.zonage.quality === "none" ? undefined : geo.zonage.quality;
      records.push({
        citySlug,
        source: "zonage",
        automation: "one_shot",
        windowMonths: 6,
        status: zonageStatus,
        ...(zonageQuality ? { dataQuality: zonageQuality as "pdf" | "geojson" | "html" | "none" } : {}),
        ...(geo.zonage.url ? { siteUrl: geo.zonage.url } : {}),
        notes: geo.notes,
      });
    }
  }

  return records;
}

/**
 * Dérive le statut ScrapeStatus pour une couche de zonage.
 *
 * - "donnees-quebec" + URL → "identified" (source open-data connue, non ingérée)
 * - "pdf" + URL → "identified" (PDF scanné connu, non ingéré)
 * - "pdf" sans URL → "todo"
 * - "unknown" | "none" → "todo"
 */
function deriveZonageStatus(
  availability: string,
  url?: string,
): ScrapeStatusT["status"] {
  if (availability === "donnees-quebec" && url) return "identified";
  if (availability === "pdf" && url) return "identified";
  if (availability === "pdf") return "todo";
  return "todo";
}

// ─────────────────────────────────────────────────────────────────────────────
// Merge : statique + surcharges manuelles (store)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fusionne les enregistrements dérivés statiquement avec les surcharges du store.
 *
 * Les enregistrements du store (PUT par les agents) ont TOUJOURS la priorité sur
 * les valeurs statiques pour la même clé (citySlug × source). La dérivation statique
 * sert de fallback pour les villes non encore mises à jour manuellement.
 *
 * @param stored - Enregistrements lus depuis le store (peut être vide).
 * @returns Liste fusionnée, sans doublon, déterministe.
 */
export function mergeWithDerived(stored: ScrapeStatusT[]): ScrapeStatusT[] {
  const derived = deriveStaticScrapeStatuses();

  // Index des enregistrements stockés par clé primaire (citySlug + source)
  const storedIndex = new Map<string, ScrapeStatusT>();
  for (const rec of stored) {
    storedIndex.set(`${rec.citySlug}::${rec.source}`, rec);
  }

  // Pour chaque enregistrement dérivé, utiliser l'enregistrement stocké si présent
  const merged: ScrapeStatusT[] = derived.map((derived) => {
    const key = `${derived.citySlug}::${derived.source}`;
    return storedIndex.get(key) ?? derived;
  });

  // Ajouter les enregistrements stockés qui ne correspondent à aucune dérivation
  // (ex : sources non couvertes par la dérivation statique, villes ajoutées manuellement)
  for (const rec of stored) {
    const key = `${rec.citySlug}::${rec.source}`;
    const inDerived = derived.some(
      (d) => `${d.citySlug}::${d.source}` === key,
    );
    if (!inDerived) {
      merged.push(rec);
    }
  }

  return merged;
}
