/**
 * Tests du service de résolution géo (resolve-refs.ts).
 *
 * DB mockée : aucun accès Postgres réel.
 * Vérifie :
 *   - Résolution d'un noeud avec zone connue
 *   - Non-résolution honnête : aucun polygone (raison=no_polygon)
 *   - Non-résolution honnête : score trop bas (raison=score_too_low)
 *   - Non-résolution honnête : aucun code extrait (raison=no_extract)
 *   - Résolution lot par no_lot_norm
 *   - Batch : resolveGeoRefsBatch cumule les stats
 *
 * Stratégie de mock DB :
 * - db.select().from().where().limit() : file positionnelle (queue)
 * - db.execute(sqlTag) : compte les appels et capture les tables cibles
 *   via un string-test sur la représentation interne du SQL Drizzle.
 */
import { describe, expect, it } from "vitest";
import { resolveGeoRefs, resolveGeoRefsBatch } from "./resolve-refs.js";
import type { Database } from "../../db/client.js";

// ─── Types ────────────────────────────────────────────────────────────────────

type SelectResult = { canonicalId: string }[];

// ─── Mock DB factory ──────────────────────────────────────────────────────────

/**
 * Crée un mock de Database basé sur une file de résultats (queue) pour les SELECTs.
 * Les db.execute() sont comptés et leur cible (geo_resolutions vs geo_unresolved)
 * est détectée par inspection du tableau de chunks de l'objet SQL Drizzle.
 *
 * L'objet SQL Drizzle expose ses chunks via un itérateur interne. On tente
 * d'en extraire une représentation string pour l'assertion; en cas d'échec,
 * on se rabat sur les compteurs de appels.
 */
interface ExecuteCall {
  isResolution: boolean;
  isUnresolved: boolean;
  raison?: string;
}

function makeMockDb(selectQueue: SelectResult[]): {
  db: Database;
  executeCalls: ExecuteCall[];
} {
  const queue = [...selectQueue];
  const executeCalls: ExecuteCall[] = [];

  const db = {
    select: (_fields: unknown) => ({
      from: (_table: unknown) => ({
        where: (_cond: unknown) => ({
          limit: (_n: number): Promise<SelectResult> => {
            const next = queue.shift();
            return Promise.resolve(next ?? []);
          },
        }),
      }),
    }),
    execute: (sqlTag: unknown): Promise<{ rows: unknown[] }> => {
      // Tenter d'extraire le texte SQL depuis l'objet SQL Drizzle.
      // Les objets sql`` Drizzle exposent leur contenu via Symbol.iterator
      // ou des propriétés internes. On inspecte ce qu'on peut.
      let sqlText = "";
      try {
        // Drizzle SQL objects have queryChunks array internally
        const tag = sqlTag as Record<string, unknown>;
        // Try common internal property names
        const chunks =
          (tag["queryChunks"] as unknown[] | undefined) ??
          (tag["chunks"] as unknown[] | undefined) ??
          [];
        sqlText = chunks
          .map((c) => (typeof c === "string" ? c : String(c)))
          .join(" ");
        // Also try direct .sql property
        if (!sqlText && typeof tag["sql"] === "string") {
          sqlText = tag["sql"] as string;
        }
      } catch {
        // ignore
      }

      const isResolution = sqlText.includes("geo_resolutions");
      const isUnresolved = sqlText.includes("geo_unresolved");

      // Extraire la raison des paramètres si disponibles
      let raison: string | undefined;
      try {
        const tag = sqlTag as Record<string, unknown>;
        const params =
          (tag["params"] as unknown[] | undefined) ??
          (tag["values"] as unknown[] | undefined) ??
          [];
        const raisonValues = ["no_polygon", "score_too_low", "ambiguous", "no_extract"];
        raison = params.find(
          (p): p is string => typeof p === "string" && raisonValues.includes(p),
        ) as string | undefined;
      } catch {
        // ignore
      }

      executeCalls.push({ isResolution, isUnresolved, raison });
      return Promise.resolve({ rows: [] });
    },
  } as unknown as Database;

  return { db, executeCalls };
}

// ─── Données de test ──────────────────────────────────────────────────────────

const BASE_INPUT = {
  nodeId: "signal-valleyfield-42",
  nodeType: "Signal" as const,
  citySlug: "salaberry-de-valleyfield",
  asOfDate: "2026-03-15",
};

// ─── resolveGeoRefs : zones ───────────────────────────────────────────────────

describe("resolveGeoRefs — zones", () => {
  it("résout un noeud avec zone explicite : resolvedZones=1, unresolvedZones=0", async () => {
    const { db } = makeMockDb([[{ canonicalId: "zone-valleyfield-h431" }]]);

    const result = await resolveGeoRefs(db, {
      ...BASE_INPUT,
      label: "Rezonage zone H-431",
      description: null,
    });

    expect(result.resolvedZones).toBe(1);
    expect(result.unresolvedZones).toBe(0);
    expect(result.nodeId).toBe(BASE_INPUT.nodeId);
  });

  it("non-résolu : zone extraite mais aucun polygone DB -> unresolvedZones=1", async () => {
    const { db } = makeMockDb([[]]); // aucune zone en DB

    const result = await resolveGeoRefs(db, {
      ...BASE_INPUT,
      label: "Rezonage zone H-431",
      description: null,
    });

    expect(result.resolvedZones).toBe(0);
    expect(result.unresolvedZones).toBe(1);
  });

  it("non-résolu : code numérique (score 0.40 < seuil 0.50) -> unresolvedZones=1", async () => {
    // Score trop bas -> aucun SELECT DB, aucune queue consommée
    const { db } = makeMockDb([]);

    const result = await resolveGeoRefs(db, {
      ...BASE_INPUT,
      label: "zone 1000 modifiée",
      description: null,
    });

    expect(result.resolvedZones).toBe(0);
    expect(result.unresolvedZones).toBe(1);
  });

  it("non-résolu : aucun code extrait -> unresolvedZones=1 (no_extract)", async () => {
    const { db } = makeMockDb([]);

    const result = await resolveGeoRefs(db, {
      ...BASE_INPUT,
      label: "Permis de construction 123 rue des Érables",
      description: null,
    });

    expect(result.resolvedZones).toBe(0);
    expect(result.unresolvedZones).toBe(1);
    expect(result.resolvedLots).toBe(0);
    expect(result.unresolvedLots).toBe(0);
  });

  it("multi-codes : H-431 résolu + C-512 no_polygon -> resolvedZones=1, unresolved=1", async () => {
    const { db } = makeMockDb([
      [{ canonicalId: "zone-valleyfield-h431" }],
      [], // C-512 non trouvé
    ]);

    const result = await resolveGeoRefs(db, {
      ...BASE_INPUT,
      label: "Rezonage zones H-431 et C-512",
      description: null,
    });

    expect(result.resolvedZones).toBe(1);
    expect(result.unresolvedZones).toBe(1);
  });

  it("insensible à la casse du label", async () => {
    const { db } = makeMockDb([[{ canonicalId: "zone-valleyfield-h431" }]]);

    const result = await resolveGeoRefs(db, {
      ...BASE_INPUT,
      label: "MODIFICATION ZONE h-431 RÉSIDENTIELLE",
      description: null,
    });

    expect(result.resolvedZones).toBe(1);
  });
});

// ─── resolveGeoRefs : lots ────────────────────────────────────────────────────

describe("resolveGeoRefs — lots", () => {
  it("résout un lot via mention explicite : resolvedLots=1", async () => {
    // "lot 6 057 912" ne contient pas de code zone -> 0 selects zone, 1 select lot
    const { db } = makeMockDb([[{ canonicalId: "lot-6057912" }]]);

    const result = await resolveGeoRefs(db, {
      ...BASE_INPUT,
      label: "Demande concernant le lot 6 057 912",
      description: null,
    });

    expect(result.resolvedLots).toBe(1);
    expect(result.unresolvedLots).toBe(0);
  });

  it("non-résolu : lot compact (score 0.45 < seuil) -> unresolvedLots=1", async () => {
    const { db } = makeMockDb([]);

    const result = await resolveGeoRefs(db, {
      ...BASE_INPUT,
      label: "Dossier 4516943 transmis",
      description: null,
    });

    expect(result.resolvedLots).toBe(0);
    expect(result.unresolvedLots).toBe(1);
  });

  it("non-résolu : lot explicite pas en DB -> unresolvedLots=1", async () => {
    const { db } = makeMockDb([[]]);

    const result = await resolveGeoRefs(db, {
      ...BASE_INPUT,
      label: "Rezonage lot 6057912",
      description: null,
    });

    expect(result.resolvedLots).toBe(0);
    expect(result.unresolvedLots).toBe(1);
  });

  it("aucun lot extrait -> resolvedLots=0, unresolvedLots=0", async () => {
    const { db } = makeMockDb([]);

    const result = await resolveGeoRefs(db, {
      ...BASE_INPUT,
      label: "Adoption du budget municipal",
      description: null,
    });

    expect(result.resolvedLots).toBe(0);
    expect(result.unresolvedLots).toBe(0);
  });
});

// ─── resolveGeoRefs : cas mixte ───────────────────────────────────────────────

describe("resolveGeoRefs — cas mixte zone + lot", () => {
  it("résout zone ET lot dans le même noeud", async () => {
    // 1 select zone résolu + 1 select lot résolu
    const { db } = makeMockDb([
      [{ canonicalId: "zone-valleyfield-h431" }],
      [{ canonicalId: "lot-6057912" }],
    ]);

    const result = await resolveGeoRefs(db, {
      ...BASE_INPUT,
      label: "Rezonage zone H-431 pour le lot 6 057 912",
      description: null,
    });

    expect(result.resolvedZones).toBe(1);
    expect(result.resolvedLots).toBe(1);
    expect(result.unresolvedZones).toBe(0);
    expect(result.unresolvedLots).toBe(0);
  });

  it("résout via description quand le label est générique", async () => {
    const { db } = makeMockDb([[{ canonicalId: "zone-valleyfield-h431" }]]);

    const result = await resolveGeoRefs(db, {
      ...BASE_INPUT,
      label: "Signal urbanisme",
      description: "Modification de la zone H-431 approuvée en séance",
    });

    expect(result.resolvedZones).toBe(1);
  });

  it("texte sans aucune référence -> unresolvedZones=1 (no_extract), unresolvedLots=0", async () => {
    const { db } = makeMockDb([]);

    const result = await resolveGeoRefs(db, {
      ...BASE_INPUT,
      label: "Adoption du budget municipal",
      description: "Présentation du budget annuel de la ville",
    });

    expect(result.resolvedZones).toBe(0);
    expect(result.resolvedLots).toBe(0);
    expect(result.unresolvedZones).toBe(1);
    expect(result.unresolvedLots).toBe(0);
  });
});

// ─── resolveGeoRefsBatch ──────────────────────────────────────────────────────

describe("resolveGeoRefsBatch", () => {
  it("cumule les statistiques de plusieurs noeuds", async () => {
    // signal-1 : zone H-431 -> résolu
    // signal-2 : "Permis..." -> no_extract -> unresolved zone
    const { db } = makeMockDb([
      [{ canonicalId: "zone-valleyfield-h431" }],
    ]);

    const inputs = [
      {
        ...BASE_INPUT,
        nodeId: "signal-1",
        label: "Rezonage zone H-431",
        description: null,
      },
      {
        ...BASE_INPUT,
        nodeId: "signal-2",
        label: "Permis de construction",
        description: null,
      },
    ];

    const stats = await resolveGeoRefsBatch(db, inputs);

    expect(stats.total).toBe(2);
    expect(stats.resolvedZones).toBe(1);
    expect(stats.unresolvedZones).toBe(1);
    expect(stats.resolvedLots).toBe(0);
    expect(stats.unresolvedLots).toBe(0);
  });

  it("tableau vide -> stats à zéro", async () => {
    const { db } = makeMockDb([]);
    const stats = await resolveGeoRefsBatch(db, []);
    expect(stats.total).toBe(0);
    expect(stats.resolvedZones).toBe(0);
    expect(stats.unresolvedZones).toBe(0);
  });
});
