/**
 * PV-SEED — Réseau de villes PV Rive-Sud (saint-constant, sainte-catherine).
 *
 * Sème les fixtures PV RÉELLES (extraits pdftotext de vrais PV publics captés
 * 2026-06-10) dans l'objet-store comme le ferait RECUEIL, puis lance
 * EXPLOITATION pour produire les mentions DesignationEvent / Bylaw depuis le
 * texte réel — SANS aucun appel réseau.
 *
 * ANTI-INVENTION (règles cardinales §0.2) :
 *   - Chaque byte mis en S3 vient d'un vrai PDF public (pdftotext).
 *   - Aucun DesignationEvent n'est fabriqué : `pvMentions` n'en émet que si
 *     `detectZonageChange` retourne `changementZonage: true` sur le texte réel.
 *   - Sainte-Catherine → 0 DesignationEvent zonage (faux-positif écarté).
 *   - Saint-Constant → ≥1 DesignationEvent zonage (règlements 1926-26/1927-26).
 *
 * La clé S3 suit le patron du RECUEIL :
 *   raw/proces-verbaux-<city>/<yyyy>/<mm>/<dd>/<sha256>.<ext>
 * ce qui déclenche la branche "pv" dans `classify()` de mentions.ts.
 */

import {
  buildRawDocumentRecord,
  PV_SAINT_CONSTANT_2026_05_TEXT,
  PV_SAINTE_CATHERINE_2026_05_TEXT,
  type RawDocumentRecord,
} from "@radar/sources";

import type { ObjectStore } from "../../storage/object-store.js";
import {
  runExploitation,
  type ExploitationResult,
} from "./exploitation.js";
import { SEED_CITY_SLUGS } from "./seed-ontology.js";

// ─────────────────────────────────────────────────────────────────────────────
// Per-city PV fixture spec
// ─────────────────────────────────────────────────────────────────────────────

/** Un extrait PV réel à peupler dans l'objet-store (pas de réseau). */
export interface PvFixtureSpec {
  /** Slug de la ville (ex. "saint-constant"). */
  readonly citySlug: string;
  /** Source-id du scraper PV (ex. "proces-verbaux-saint-constant"). */
  readonly sourceId: string;
  /** URL publique d'origine du PDF (provenance — jamais re-fetchée). */
  readonly sourceUrl: string;
  /** Texte brut extrait (pdftotext) du vrai PV PDF. */
  readonly pvText: string;
}

/**
 * Fixtures réelles des villes Rive-Sud proches de Montréal.
 * Données captées 2026-06-10 depuis des PDFs publics (robots.txt : sans restrictions).
 */
export const PV_FIXTURES: readonly PvFixtureSpec[] = [
  {
    citySlug: "saint-constant",
    sourceId: "proces-verbaux-saint-constant",
    sourceUrl:
      "https://saint-constant.ca/uploads/attachments/Greffe/2026/2026-05-19/2026-05-19_PV_Seance_ordinaire_non_approuve_par_Conseil.pdf",
    pvText: PV_SAINT_CONSTANT_2026_05_TEXT,
  },
  {
    citySlug: "sainte-catherine",
    sourceId: "proces-verbaux-sainte-catherine",
    sourceUrl:
      "https://www.ville.sainte-catherine.qc.ca/medias/documents/content/PvCm-20260512-vns-vp20260514.pdf",
    pvText: PV_SAINTE_CATHERINE_2026_05_TEXT,
  },
];

/** Slugs des villes PV-seed (Rive-Sud). */
export const PV_SEED_CITY_SLUGS: readonly string[] = PV_FIXTURES.map(
  (f) => f.citySlug,
);

/**
 * Toutes les villes couvertes par l'endpoint `GET /api/signals/by-city` :
 *   - Villes MAMH (role + avis + adresses) : salaberry-de-valleyfield, beauharnois
 *   - Villes PV Rive-Sud : saint-constant, sainte-catherine
 * Une ville sans project-state persisté retourne designationEventCount=0 (honnête).
 */
export const ALL_SIGNALS_CITY_SLUGS: readonly string[] = [
  ...SEED_CITY_SLUGS,
  ...PV_SEED_CITY_SLUGS,
];

// ─────────────────────────────────────────────────────────────────────────────
// Résultat du seed PV
// ─────────────────────────────────────────────────────────────────────────────

export interface PvSeedResult {
  readonly ok: boolean;
  readonly citySlug: string;
  /** Clé S3 sous laquelle le texte PV a été stocké. */
  readonly pvRawRef: string;
  readonly mentionCount: number;
  readonly candidateCount: number;
  readonly canonicalCount: number;
  /** Nombre de DesignationEvent canoniques produits par l'exploitation. */
  readonly designationEventCount: number;
  /** Clé S3 du project-state produit. */
  readonly stateKey: string;
  readonly exploitation: ExploitationResult;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fonctions publiques
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sème le texte PV réel d'une ville Rive-Sud dans l'objet-store puis lance
 * l'exploitation pour produire les mentions / canoniques PV.
 *
 * La clé S3 suit le patron `raw/proces-verbaux-<city>/…` que `classify()` dans
 * mentions.ts reconnaît comme branche "pv" (texte plain/text → pvMentions).
 *
 * Idempotent : si le document est déjà en S3, on saute le PUT.
 */
export async function seedPvCity(
  store: ObjectStore,
  citySlug: string,
  now: () => Date = () => new Date(),
): Promise<PvSeedResult> {
  const spec = PV_FIXTURES.find((f) => f.citySlug === citySlug);
  if (!spec) {
    throw new Error(
      `pv-seed: aucune fixture PV pour la ville "${citySlug}" (disponibles : ${PV_SEED_CITY_SLUGS.join(", ")})`,
    );
  }

  const fetchedAt = now().toISOString();
  const pvBytes = new TextEncoder().encode(spec.pvText);

  // Stocker le texte PV comme text/plain sous la clé canonique RECUEIL.
  // La clé contient "proces-verbaux-<city>" → classifié "pv" par isPvRawRef().
  const record: RawDocumentRecord = buildRawDocumentRecord({
    source: spec.sourceId,
    sourceUrl: spec.sourceUrl,
    body: pvBytes,
    fetchedAt,
    contentType: "text/plain; charset=utf-8",
    provenance: {
      version: "seed-1",
      userAgent: "radar-pv-seed",
      viaObscura: false,
    },
  });

  const existing = await store.head(record.storageKey);
  if (!existing) {
    await store.put(record.storageKey, pvBytes, record.contentType);
  }

  // Exploitation : extrait les mentions PV (Bylaw + DesignationEvent) et
  // persiste le project-state de la ville dans l'objet-store.
  const exploitation = await runExploitation({
    store,
    citySlug,
    rawDocRecords: [record],
    now,
  });

  const designationEventCount = exploitation.state.canonicals.filter(
    (c) => c.type === "DesignationEvent",
  ).length;

  return {
    ok: exploitation.ok,
    citySlug,
    pvRawRef: record.storageKey,
    mentionCount: exploitation.mentionCount,
    candidateCount: exploitation.candidateCount,
    canonicalCount: exploitation.canonicalCount,
    designationEventCount,
    stateKey: exploitation.stateKey,
    exploitation,
  };
}
