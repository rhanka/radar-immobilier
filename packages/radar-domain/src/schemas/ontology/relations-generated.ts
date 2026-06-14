// ============================================================
// FICHIER GÉNÉRÉ — ne pas éditer à la main.
// Source : radar/ontology/ontology-profile.yaml (section relation_types)
// Régénérer : npm run gen:onto  (depuis packages/radar-domain/)
// ============================================================

import { z } from "zod";

/** Les 25 types de relations canoniques v2.0 du profil graphify (§1.2 / §8.1). */
export const OntoRelationType = z.enum([
  // ── Localisation ──────────────────────────────────────────────────────────
  "located_in",
  "located_at",
  // ── Gouvernance réglementaire ─────────────────────────────────────────────
  "governed_by",
  "amends",
  "defines",
  // ── Événements de désignation ─────────────────────────────────────────────
  "rezones",
  "splits",
  "merges",
  "subdivides",
  "supersedes",
  "targets_zone",
  "targets_lot",
  "raises_signal",
  "concerns",
  // ── Lots ──────────────────────────────────────────────────────────────────
  "assigned_zone",
  "issued_for",
  "subject_of",
  // ── Contraintes ───────────────────────────────────────────────────────────
  "constrains",
  "applies_to",
  // ── Sources / preuves ─────────────────────────────────────────────────────
  "mentions",
  "supports",
  "references",
  "flags",
  "derived_from",
  "has_source",
]);
export type OntoRelationTypeT = z.infer<typeof OntoRelationType>;

/**
 * Clés extraites du YAML à la génération — utilisées par le test de non-dérive.
 * Ce tableau doit rester synchronisé avec OntoRelationType.options.
 */
export const YAML_RELATION_KEYS: readonly string[] = [
  "located_in",
  "located_at",
  "governed_by",
  "amends",
  "defines",
  "rezones",
  "splits",
  "merges",
  "subdivides",
  "supersedes",
  "targets_zone",
  "targets_lot",
  "raises_signal",
  "concerns",
  "assigned_zone",
  "issued_for",
  "subject_of",
  "constrains",
  "applies_to",
  "mentions",
  "supports",
  "references",
  "flags",
  "derived_from",
  "has_source"
] as const;
