/**
 * migrate-fixtures-to-s3.ts — Lot 2c. Migre les villes « golden » (`PV_FIXTURES`)
 * vers l'objet-store CAS **sans réseau, en mémoire**.
 *
 * Les fixtures golden ne capturent QUE le `pvText` — le TEXTE extrait (pdftotext)
 * d'un vrai PV public, pas le PDF original. Cette migration honnête écrit ce texte
 * tel quel comme objet `text/plain` sous une clé content-addressée (CAS) +
 * son sidecar `.meta.json`, exactement comme le ferait le RECUEIL. Spec
 * docs/spec/SPEC_PERSISTENCE_S3_FIRST.md §3.
 *
 * ANTI-INVENTION (règles cardinales §0.2) :
 *   - Chaque byte écrit vient d'un vrai PV public (pdftotext) déjà capté.
 *   - La meta étiquette explicitement le contenu comme TEXTE EXTRAIT migré d'une
 *     fixture (`migration.obtentionMode = "extracted-text"`, `isOriginalPdf =
 *     false`). On ne prétend JAMAIS que c'est le PDF source.
 *   - Le worker live backfillera le `raw/` PDF original au prochain refresh ; il
 *     produira sa propre clé CAS (le PDF a un sha256 différent du texte extrait).
 *
 * Idempotent : un 2e passage est un HEAD-skip (la clé CAS dépend du contenu, pas
 * de la date), donc rien n'est réécrit et `skipped` compte les déjà-présents.
 */

import {
  buildRawDocumentRecord,
  rawMetaKey,
  type RawDocumentRecord,
} from "@radar/sources";

import type { ObjectStore } from "../../storage/object-store.js";
import { PV_FIXTURES, type PvFixtureSpec } from "./pv-seed.js";

/** Une fixture golden à migrer (texte extrait d'un vrai PV public). */
export type FixtureToMigrate = PvFixtureSpec;

/** Options de migration (injection d'horloge pour des tests déterministes). */
export interface MigrateFixturesOptions {
  /** Horloge injectable — `fetchedAt` de la meta. */
  now?: () => Date;
}

/** Bilan d'une passe de migration. */
export interface MigrateFixturesResult {
  /** Nombre de fixtures effectivement écrites cette passe. */
  readonly migrated: number;
  /** Nombre de fixtures déjà présentes en S3 (HEAD-skip). */
  readonly skipped: number;
}

/**
 * Étiquette d'honnêteté ajoutée au sidecar `.meta.json` (en plus du
 * `RawDocumentRecord`). Elle dit clairement que ce raw est le TEXTE EXTRAIT
 * migré d'une fixture — pas le PDF source.
 */
interface MigrationLabel {
  /** Mode d'obtention du contenu : ici, du texte déjà extrait (pdftotext). */
  readonly obtentionMode: "extracted-text";
  /** Origine : une fixture golden committée, pas un fetch réseau live. */
  readonly source: "fixture";
  /** Faux : ce n'est PAS le PDF binaire original. */
  readonly isOriginalPdf: false;
  /** Note humaine anti-invention. */
  readonly note: string;
}

const MIGRATION_NOTE =
  "Texte extrait (pdftotext) migré d'une fixture golden — PAS le PDF original. " +
  "Le worker live backfillera le PDF source (raw/) au prochain refresh, sous une " +
  "clé CAS distincte (le PDF a un sha256 différent du texte extrait).";

const MIGRATION_LABEL: MigrationLabel = {
  obtentionMode: "extracted-text",
  source: "fixture",
  isOriginalPdf: false,
  note: MIGRATION_NOTE,
};

/**
 * Migre `fixtures` (par défaut `PV_FIXTURES`) vers `store` : pour chaque fixture,
 * écrit le texte extrait comme raw CAS `text/plain` + son sidecar `.meta.json`
 * honnête. Idempotent (HEAD-skip sur la clé CAS). Aucun appel réseau.
 */
export async function migrateFixturesToS3(
  store: ObjectStore,
  fixtures: readonly FixtureToMigrate[] = PV_FIXTURES,
  options: MigrateFixturesOptions = {},
): Promise<MigrateFixturesResult> {
  const now = options.now ?? (() => new Date());

  let migrated = 0;
  let skipped = 0;

  for (const fixture of fixtures) {
    const fetchedAt = now().toISOString();
    const pvBytes = new TextEncoder().encode(fixture.pvText);

    // Clé CAS déterministe : raw/<sourceId>/cas/<sha256>.txt (pas de date).
    const record: RawDocumentRecord = buildRawDocumentRecord({
      source: fixture.sourceId,
      sourceUrl: fixture.sourceUrl,
      body: pvBytes,
      fetchedAt,
      contentType: "text/plain; charset=utf-8",
      provenance: {
        version: "fixture-migration",
        userAgent: "radar/migration",
        viaObscura: false,
      },
    });

    // Idempotence : si le raw CAS existe déjà, on ne réécrit ni le raw ni la meta.
    const existing = await store.head(record.storageKey);
    if (existing) {
      skipped += 1;
      continue;
    }

    // 1) Les bytes du texte extrait.
    await store.put(record.storageKey, pvBytes, record.contentType);

    // 2) Le sidecar meta : le RawDocumentRecord + l'étiquette d'honnêteté.
    const metaPayload = { ...record, migration: MIGRATION_LABEL };
    await store.put(
      rawMetaKey(record.storageKey),
      new TextEncoder().encode(JSON.stringify(metaPayload, null, 2)),
      "application/json; charset=utf-8",
    );

    migrated += 1;
  }

  return { migrated, skipped };
}
