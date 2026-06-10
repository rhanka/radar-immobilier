/**
 * Dérivation statique du ScrapeStatus réel par ville×source.
 *
 * Cette fonction construit la liste des ScrapeStatus à partir des sources de vérité
 * statiques (ALL_PV_CITIES, SEED_CITY_SLUGS, GeoSourceInventory, QC_MUNICIPALITIES) —
 * sans inventer.
 *
 * Règles anti-invention (MASTER.md §0.2) :
 *   - status "scraped" ⟺ le fixture PV existe dans ALL_PV_CITIES (texte réel).
 *   - status "graphified" ⟺ déclaré uniquement pour les villes MAMH dont le
 *     seed-ontology a été exécuté et produit un project-state.
 *   - status "identified" ⟺ URL ou config connue mais aucune ingestion vérifiée.
 *   - status "todo" ⟺ source prévue mais non encore identifiée/câblée.
 *   - dataQuality = "pdf" pour les PV (toujours PDF sauf exception notée).
 *   - dataQuality = "geojson" quand GeoSourceInventory confirme une source vecteur.
 *
 * @module
 */

import { ALL_PV_CITIES, getGeoSourceInventory, QC_MUNICIPALITIES } from "@radar/sources";
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
 * - Pour toutes les villes QC_MUNICIPALITIES NON câblées (hors ALL_PV_CITIES) :
 *   source "conseils-municipaux", status "todo", dataQuality absent.
 *   Les villes avec excluded:true sont marquées avec notes d'exclusion.
 *
 * La liste est stable et déterministe — pas de réseaux, pas de store.
 * Les enregistrements peuvent être surchargés par PUT /api/scrape-status
 * (agents de recueil peuvent upgrader le statut en "graphified" après ingestion).
 */
export function deriveStaticScrapeStatuses(): ScrapeStatusT[] {
  const records: ScrapeStatusT[] = [];

  // ── 1. Villes PV génériques (ALL_PV_CITIES) ──────────────────────────────
  // Ensemble des citySlug câblés (fixture PV réelle)
  const wiredSlugs = new Set(ALL_PV_CITIES.map((city) => city.config.citySlug));

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

  // ── 3. Inventaire provincial : villes QC non encore câblées ───────────────
  // Pour toutes les villes QC_MUNICIPALITIES qui n'ont pas de fixture PV câblée
  // et ne sont pas déjà couvertes par les enregistrements MAMH ci-dessus,
  // on produit un enregistrement "todo" honnête.
  //
  // On exclut aussi les villes MAMH (salaberry-de-valleyfield, beauharnois) :
  // elles sont suivies via leurs propres sources (avis-publics, role-evaluation,
  // zonage), mais pas encore câblées pour conseils-municipaux.
  const mamhSlugs = new Set(MAMH_CITIES.map((m) => m.citySlug));
  const alreadyCovered = new Set(records.map((r) => `${r.citySlug}::${r.source}`));

  for (const mun of QC_MUNICIPALITIES) {
    const citySlug = mun.slug;
    const key = `${citySlug}::conseils-municipaux`;

    // Déjà couvert par ALL_PV_CITIES (scraped) ou enregistrement existant
    if (alreadyCovered.has(key)) continue;
    // Déjà câblé dans wiredSlugs — devrait déjà être dans records, skip
    if (wiredSlugs.has(citySlug)) continue;
    // Ville MAMH : suivie via d'autres sources, pas encore câblée CM
    if (mamhSlugs.has(citySlug)) continue;

    if (mun.excluded) {
      // Montréal, Laval : présents dans le dataset mais hors périmètre de scraping actif.
      // Comptés dans l'inventaire provincial avec note d'exclusion.
      records.push({
        citySlug,
        source: "conseils-municipaux",
        automation: "one_shot",
        windowMonths: 6,
        status: "todo",
        dataQuality: "none",
        notes: `Ville exclue du périmètre de recueil actif (${mun.excludedReason ?? "excluded"}).`,
      });
    } else {
      // Ville non câblée : statut honnête "todo", aucune donnée inventée.
      records.push({
        citySlug,
        source: "conseils-municipaux",
        automation: "one_shot",
        windowMonths: 6,
        status: "todo",
        notes: mun.deprioritized
          ? `Ville déprioritisée (pop > 100k, rang ${mun.priorityRank ?? "N/A"}). Recueil PV non encore câblé.`
          : `Recueil PV non encore câblé (rang ${mun.priorityRank ?? "N/A"}, MRC: ${mun.mrc ?? "N/A"}).`,
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
// Coverage : agrégat de couverture provinciale
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Statut de couverture provinciale pour la source "conseils-municipaux".
 */
export interface ProvincialCoverage {
  /** Nombre total de villes dans QC_MUNICIPALITIES (1106). */
  total: number;
  /** Répartition par statut. */
  byStatus: {
    todo: number;
    identified: number;
    scraped: number;
    graphified: number;
    error: number;
  };
  /** Répartition par MRC (nombre de villes par statut par MRC). */
  byMrc: Record<string, { total: number; scraped: number; todo: number }>;
}

/**
 * Calcule l'agrégat de couverture provinciale pour la source "conseils-municipaux".
 *
 * Dérivé purement en mémoire depuis les enregistrements merged (aucun réseau,
 * aucune DB). Utilise QC_MUNICIPALITIES pour le total de référence (1106).
 *
 * @param merged - Liste ScrapeStatus fusionnée (deriveStaticScrapeStatuses ou mergeWithDerived).
 */
export function deriveProvincialCoverage(merged: ScrapeStatusT[]): ProvincialCoverage {
  // Filtrer les enregistrements conseils-municipaux
  const cmRecords = merged.filter((r) => r.source === "conseils-municipaux");

  // Index par citySlug pour lookup O(1)
  const bySlug = new Map<string, ScrapeStatusT>();
  for (const r of cmRecords) {
    bySlug.set(r.citySlug, r);
  }

  const byStatus: ProvincialCoverage["byStatus"] = {
    todo: 0,
    identified: 0,
    scraped: 0,
    graphified: 0,
    error: 0,
  };

  const byMrc: ProvincialCoverage["byMrc"] = {};

  for (const mun of QC_MUNICIPALITIES) {
    const rec = bySlug.get(mun.slug);
    const status: ScrapeStatusT["status"] = rec?.status ?? "todo";

    byStatus[status] = (byStatus[status] ?? 0) + 1;

    // Agrégat par MRC (null pour villes sans MRC = agglomérations)
    const mrcKey = mun.mrc ?? "(sans MRC)";
    if (!byMrc[mrcKey]) {
      byMrc[mrcKey] = { total: 0, scraped: 0, todo: 0 };
    }
    byMrc[mrcKey]!.total += 1;
    if (status === "scraped" || status === "graphified") {
      byMrc[mrcKey]!.scraped += 1;
    } else if (status === "todo" || status === "error") {
      byMrc[mrcKey]!.todo += 1;
    }
  }

  return {
    total: QC_MUNICIPALITIES.length,
    byStatus,
    byMrc,
  };
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
