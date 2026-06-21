#!/usr/bin/env tsx
/**
 * Codegen : génère packages/radar-domain/src/schemas/ontology/relations-generated.ts
 * depuis la section `relation_types` de radar/ontology/ontology-profile.yaml.
 *
 * USAGE (rejouable, idempotent) :
 *   npm run gen:onto              # depuis packages/radar-domain/
 *   tsx scripts/gen-relation-types.ts
 *
 * Câblé en prebuild dans package.json → exécuté automatiquement avant
 * chaque build et vérifié par le test de non-dérive dans relations.test.ts.
 *
 * DETTE TECHNIQUE RÉSOLUE : #54 — double source de vérité supprimée.
 *   Avant : enum OntoRelationType hardcodé dans relations.ts.
 *   Après : généré automatiquement depuis ontology-profile.yaml (source unique).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Chemins ─────────────────────────────────────────────────────────────────
const YAML_PATH = resolve(__dirname, "../../../radar/ontology/ontology-profile.yaml");
const OUT_PATH = resolve(__dirname, "../src/schemas/ontology/relations-generated.ts");

// ── Lecture et parse du YAML ─────────────────────────────────────────────────
const raw = readFileSync(YAML_PATH, "utf-8");
const profile = parse(raw) as { relation_types: Record<string, unknown> };

if (!profile.relation_types || typeof profile.relation_types !== "object") {
  console.error(`ERREUR : section relation_types introuvable dans ${YAML_PATH}`);
  process.exit(1);
}

const relationKeys = Object.keys(profile.relation_types);

if (relationKeys.length === 0) {
  console.error("ERREUR : aucune relation trouvée dans le YAML");
  process.exit(1);
}

// ── Catégories (ordre du YAML conservé, commentaires reconstruits) ────────────
// Ces catégories reflètent la structure du YAML ; si de nouvelles relations
// sont ajoutées au YAML sans être catégorisées ici, elles seront ajoutées
// à la fin avec un avertissement.
const categories: { comment: string; keys: string[] }[] = [
  {
    comment: "── Localisation ──────────────────────────────────────────────────────────",
    keys: ["located_in", "located_at"],
  },
  {
    comment: "── Gouvernance réglementaire ─────────────────────────────────────────────",
    keys: ["governed_by", "amends", "defines"],
  },
  {
    comment: "── Événements de désignation ─────────────────────────────────────────────",
    keys: ["rezones", "splits", "merges", "subdivides", "supersedes", "targets_zone", "targets_lot", "raises_signal", "concerns"],
  },
  {
    comment: "── Lots ──────────────────────────────────────────────────────────────────",
    keys: ["assigned_zone", "issued_for", "subject_of"],
  },
  {
    comment: "── Contraintes ───────────────────────────────────────────────────────────",
    keys: ["constrains", "applies_to"],
  },
  {
    comment: "── Sources / preuves ─────────────────────────────────────────────────────",
    keys: ["mentions", "supports", "references", "flags", "derived_from", "has_source"],
  },
];

const categorizedKeys = categories.flatMap((c) => c.keys);
const missingFromCategories = relationKeys.filter((k) => !categorizedKeys.includes(k));
const missingFromYaml = categorizedKeys.filter((k) => !relationKeys.includes(k));

if (missingFromCategories.length > 0) {
  console.warn(`AVERTISSEMENT : ${missingFromCategories.join(", ")} présent dans le YAML mais sans catégorie → ajouté à la fin`);
}
if (missingFromYaml.length > 0) {
  console.error(`ERREUR : ${missingFromYaml.join(", ")} attendu dans le YAML mais absent`);
  process.exit(1);
}

// ── Génération du fichier TS ─────────────────────────────────────────────────
const lines: string[] = [
  "// ============================================================",
  "// FICHIER GÉNÉRÉ — ne pas éditer à la main.",
  "// Source : radar/ontology/ontology-profile.yaml (section relation_types)",
  "// Régénérer : npm run gen:onto  (depuis packages/radar-domain/)",
  "// ============================================================",
  "",
  'import { z } from "zod";',
  "",
  `/** Les ${String(relationKeys.length)} types de relations canoniques v2.0 du profil graphify (§1.2 / §8.1). */`,
  "export const OntoRelationType = z.enum([",
];

for (const { comment, keys } of categories) {
  lines.push(`  // ${comment}`);
  for (const key of keys) {
    lines.push(`  "${key}",`);
  }
}

for (const key of missingFromCategories) {
  lines.push(`  "${key}", // non catégorisé — à classer dans les catégories ci-dessus`);
}

lines.push(
  "]);",
  "export type OntoRelationTypeT = z.infer<typeof OntoRelationType>;",
  "",
  "/**",
  " * Clés extraites du YAML à la génération — utilisées par le test de non-dérive.",
  " * Ce tableau doit rester synchronisé avec OntoRelationType.options.",
  " */",
  `export const YAML_RELATION_KEYS: readonly string[] = ${JSON.stringify(relationKeys, null, 2)} as const;`,
  "",
);

const output = lines.join("\n");
writeFileSync(OUT_PATH, output, "utf-8");
console.log(`[gen:onto] ${String(relationKeys.length)} relations générées → ${OUT_PATH}`);
