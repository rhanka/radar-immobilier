/**
 * CHECK-ARCHI (LOT 1 serving, A.5 / D5 / P3) — invariant §3 « une seule dérivation
 * ferme/anticipation, persistée, LUE par tous les consommateurs ; aucun ne
 * re-classifie ». Face SERVEUR du check-archi 2-faces (la face CLIENT — la vue lit
 * le champ / hide-72 — est testée dans la PR A.4/D3 de vues).
 *
 * Anti-régression architecturale : si un futur consommateur re-classifie
 * firm/anticipation en local (au lieu de LIRE le champ servi), une de ces
 * assertions casse. C'est le signal (la cause racine « 026-508 »), pas une corvée.
 *
 * Pur : lit les SOURCES sur disque, aucun Docker/DB/S3/réseau.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, it, expect } from "vitest";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (rel: string): string => readFileSync(resolve(REPO_ROOT, rel), "utf8");

// La brique unique (classifieur + locus lecture + agrégat).
const DOMAIN = "packages/radar-domain/src/schemas/ontology/reglement-lifecycle.ts";
// Le SEUL locus de dérivation persistée (matérialisation).
const PERSIST = "api/src/services/graph/graph-store.ts";
// Les consommateurs SERVANT des nœuds — doivent LIRE le champ, jamais re-classifier.
const NODE_SERVING_CONSUMERS = [
  "api/src/routes/graph-signals.ts",
  "api/src/services/geo/geo-features.ts",
  "api/src/scripts/export-designation-events.ts",
] as const;

describe("check-archi FACE-1 — deriveRegulatoryStatus = SEUL classifieur firm/anticipation", () => {
  it("les 3 primitives vivent dans @radar/domain (single-source)", () => {
    const src = read(DOMAIN);
    expect(src).toContain("export function deriveRegulatoryStatus(");
    expect(src).toContain("export function readRegulatoryStatus(");
    expect(src).toContain("export function aggregateRegulatoryStatus(");
  });

  it("le classifieur brut `deriveRegulatoryStatus(` n'est APPELÉ qu'au locus persist (graph-store), jamais par un consommateur", () => {
    // buildNodeRow (matérialisation) = le SEUL appel direct sanctionné hors domain.
    expect(read(PERSIST)).toContain("deriveRegulatoryStatus({ statut, etape })");
    // Aucun consommateur node-serving n'appelle le classifieur brut (ils LISENT).
    for (const rel of NODE_SERVING_CONSUMERS) {
      expect(read(rel), `${rel} ne doit PAS re-classifier via deriveRegulatoryStatus(`).not.toContain(
        "deriveRegulatoryStatus(",
      );
    }
  });

  it("chaque consommateur node-serving LIT via le locus unique readRegulatoryStatus", () => {
    for (const rel of NODE_SERVING_CONSUMERS) {
      expect(read(rel), `${rel} doit LIRE via readRegulatoryStatus`).toContain("readRegulatoryStatus(");
    }
  });

  it("l'agrégat PAR cible (reverse-invariant) passe par aggregateRegulatoryStatus, pas une logique ad hoc", () => {
    // geo-features agrège le regulatoryStatus des nœuds d'une zone (firm iff ≥1 firm).
    expect(read("api/src/services/geo/geo-features.ts")).toContain("aggregateRegulatoryStatus(");
  });
});

describe("check-archi FACE-2 — chaque payload servi PORTE regulatoryStatus", () => {
  it("graph-signals : GraphSignalCard porte regulatoryStatus + etape", () => {
    const src = read("api/src/routes/graph-signals.ts");
    expect(src).toContain("regulatoryStatus: RegulatoryStatusT");
    expect(src).toContain("etape: string | null");
  });

  it("geo-features : opportunité (per-node) + zone (agrégat) portent regulatoryStatus", () => {
    const src = read("api/src/services/geo/geo-features.ts");
    // OpportuniteFeatureProperties (per-node) + ZoneFeatureProperties (agrégat).
    expect(src).toContain("regulatoryStatus: RegulatoryStatusT");
    expect(src).toContain("regulatoryStatus: RegulatoryStatusT | null");
  });

  it("export-designation-events : la ligne NDJSON porte regulatoryStatus", () => {
    expect(read("api/src/scripts/export-designation-events.ts")).toContain("regulatoryStatus: readRegulatoryStatus({");
  });

  it("immo-mcp : MockSignal porte regulatoryStatus, LU en passthrough (0 dérivation, 0 dép @radar/domain)", () => {
    const mocks = read("packages/immo-mcp/src/mocks.ts");
    expect(mocks).toContain('regulatoryStatus: "firm" | "anticipation"');
    const dataSource = read("packages/immo-mcp/src/data-source.ts");
    // Passthrough du champ servi + fail-safe, jamais re-classifié.
    expect(dataSource).toContain('regulatoryStatus: node.regulatoryStatus ?? "anticipation"');
    // Découplage volontaire : le MCP ne dépend PAS du classifieur (le ré-importer/
    // ré-implémenter serait l'anti-pattern re-classifieur).
    expect(dataSource, "immo-mcp reste découplé de @radar/domain (passthrough only)").not.toContain(
      "@radar/domain",
    );
  });
});

describe("check-archi FACE-2 — condition vivier-v2 SKIP (i-arch) : 0 chemin node-serving sans le champ", () => {
  it("classifyGraphNodeVivierV2 n'est consommé QUE par graph-signals (qui porte déjà le champ top-level)", () => {
    // Prouve le SKIP 0-leak : la classif vivier n'est jamais servie par un nœud
    // hors de la carte graph-signals (qui porte regulatoryStatus en 1re-classe A.3b).
    expect(read("api/src/routes/graph-signals.ts")).toContain("classifyGraphNodeVivierV2(");
    for (const rel of [
      "api/src/services/geo/geo-features.ts",
      "api/src/scripts/export-designation-events.ts",
      "packages/immo-mcp/src/data-source.ts",
    ]) {
      expect(read(rel), `${rel} ne sert pas la classif vivier hors carte`).not.toContain(
        "classifyGraphNodeVivierV2",
      );
    }
  });
});
