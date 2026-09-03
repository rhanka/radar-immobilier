/**
 * entity-search — recherche PURE + classement des listes d'entités du panneau
 * droit (zones, lots). Sœur de `filterRailCityItems` (rail villes) : mêmes
 * garanties (insensible casse/accents, requête vide = identité) + RANKING par
 * pertinence (exact > préfixe > sous-chaîne libellé > sous-chaîne sous-libellé)
 * et l'arithmétique de la navigation clavier (↑/↓).
 */
import { describe, it, expect } from "vitest";
import { normalizeLotKey, zoneSearchKey } from "@radar/domain";
import {
  canonicalRank,
  normalizeSearch,
  matchRank,
  rankBySearch,
  nextActiveIndex,
  type SearchableText,
} from "./entity-search.js";

interface Row {
  id: string;
  code: string;
  label?: string | null;
}

const accessor = (r: Row): SearchableText => ({ text: r.code, subtext: r.label });

function rows(...defs: Array<[string, string, (string | null)?]>): Row[] {
  return defs.map(([id, code, label]) => ({ id, code, label: label ?? null }));
}

describe("normalizeSearch", () => {
  it("minuscule + trim", () => {
    expect(normalizeSearch("  H-315  ")).toBe("h-315");
  });

  it("supprime les diacritiques", () => {
    expect(normalizeSearch("Québec")).toBe("quebec");
    expect(normalizeSearch("Rue Principale É")).toBe("rue principale e");
  });
});

describe("matchRank — paliers de pertinence", () => {
  it("égalité exacte = 0, préfixe = 1, autre sous-chaîne = 2", () => {
    expect(matchRank("H-3", null, "h-3")).toBe(0);
    expect(matchRank("H-315", null, "h-3")).toBe(1);
    expect(matchRank("BH-3", null, "h-3")).toBe(2);
  });

  it("correspondance seulement dans le sous-libellé = 3", () => {
    expect(matchRank("5399042", "10 rue Principale", "princ")).toBe(3);
  });

  it("aucune correspondance = -1", () => {
    expect(matchRank("H-315", "habitation", "zzz")).toBe(-1);
  });

  it("normalise le libellé/sous-libellé (casse + accents) contre une requête normalisée", () => {
    // `qNorm` est fournie DÉJÀ normalisée (contrat) ; le libellé et le
    // sous-libellé, eux, sont normalisés par matchRank.
    expect(matchRank("CO-939", "Zone Québec", "quebec")).toBe(3);
    expect(matchRank("H-315", null, "h-3")).toBe(1);
  });
});

describe("rankBySearch — filtrage + classement", () => {
  it("requête vide → liste inchangée (identité, ordre métier préservé)", () => {
    const items = rows(["a", "H-9"], ["b", "A-1"], ["c", "C-4"]);
    expect(rankBySearch(items, "", accessor).map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(rankBySearch(items, "   ", accessor).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("écarte les non-correspondances (aucun résultat fabriqué)", () => {
    const items = rows(["a", "H-315"], ["b", "A-16"], ["c", "H-3"]);
    expect(rankBySearch(items, "h-3", accessor).map((r) => r.id)).toEqual(["c", "a"]);
    // A-16 (aucune correspondance) est absente.
    expect(rankBySearch(items, "h-3", accessor).some((r) => r.id === "b")).toBe(false);
  });

  it("classe préfixe AVANT sous-chaîne, exact en tête", () => {
    const items = rows(["sub", "BH-3"], ["pref", "H-315"], ["exact", "H-3"]);
    expect(rankBySearch(items, "h-3", accessor).map((r) => r.id)).toEqual([
      "exact",
      "pref",
      "sub",
    ]);
  });

  it("les correspondances de libellé priment sur celles de sous-libellé", () => {
    const items = rows(
      ["byLabel", "5399042", "impasse Principale"],
      ["byText", "PRINC-2", "autre"],
    );
    // "princ" matche PRINC-2 par préfixe (palier 1) et 5399042 par sous-libellé
    // (palier 3) → le libellé d'abord.
    expect(rankBySearch(items, "princ", accessor).map((r) => r.id)).toEqual([
      "byText",
      "byLabel",
    ]);
  });

  it("stable dans un même palier (préserve l'ordre d'entrée)", () => {
    const items = rows(["a", "H-31"], ["b", "H-32"], ["c", "H-33"]);
    // Tous préfixes de "h-3" → même palier → ordre d'entrée conservé.
    expect(rankBySearch(items, "h-3", accessor).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("insensible à la casse et aux accents sur toute la liste", () => {
    const items = rows(["a", "CO-939", "Québec Nord"], ["b", "H-1", "Sud"]);
    expect(rankBySearch(items, "quebec", accessor).map((r) => r.id)).toEqual(["a"]);
  });
});

describe("rankBySearch — clés canoniques zone/lot", () => {
  const canonicalAccessor = (r: Row): SearchableText => ({
    text: r.code,
    subtext: r.label,
    searchKey: zoneSearchKey(r.code),
  });

  it("matche H101 avec H-101 en exact normalisé", () => {
    const items = rows(["zone", "H-101"]);
    const queryKey = zoneSearchKey("H101");

    expect(canonicalRank(zoneSearchKey(items[0].code), queryKey)).toBe(0);
    expect(rankBySearch(items, "H101", canonicalAccessor, queryKey)).toEqual(items);
  });

  it("conserve tous les candidats verbatim many-to-one dans leur ordre stable", () => {
    const items = rows(["first", "H-101"], ["second", "H-10-1"]);

    expect(
      rankBySearch(items, "H101", canonicalAccessor, zoneSearchKey("H101")).map(
        (r) => r.code,
      ),
    ).toEqual(["H-101", "H-10-1"]);
  });

  it("matche H10 avec H-101 en préfixe canonique", () => {
    const items = rows(["zone", "H-101"]);
    const queryKey = zoneSearchKey("H10");

    expect(canonicalRank(zoneSearchKey(items[0].code), queryKey)).toBe(1);
    expect(rankBySearch(items, "H10", canonicalAccessor, queryKey)).toEqual(items);
  });

  it("matche un lot sans séparateurs en exact puis en préfixe", () => {
    const items = rows(["lot", "6 057 912"]);
    const lotAccessor = (r: Row): SearchableText => ({
      text: r.code,
      searchKey: normalizeLotKey(r.code),
    });

    expect(
      rankBySearch(items, "6057912", lotAccessor, normalizeLotKey("6057912")),
    ).toEqual(items);
    expect(rankBySearch(items, "605", lotAccessor, normalizeLotKey("605"))).toEqual(
      items,
    );
  });

  it("ne fabrique aucun match fuzzy sur la clé canonique", () => {
    const items = rows(["zone", "H-101"]);

    expect(
      rankBySearch(items, "H201", canonicalAccessor, zoneSearchKey("H201")),
    ).toEqual([]);
  });
});

describe("nextActiveIndex — navigation clavier ↑/↓", () => {
  it("liste vide → reste -1", () => {
    expect(nextActiveIndex(-1, 1, 0)).toBe(-1);
    expect(nextActiveIndex(2, -1, 0)).toBe(-1);
  });

  it("depuis -1 : ↓ va au premier, ↑ va au dernier", () => {
    expect(nextActiveIndex(-1, 1, 3)).toBe(0);
    expect(nextActiveIndex(-1, -1, 3)).toBe(2);
  });

  it("défile en boucle vers l'avant et l'arrière", () => {
    expect(nextActiveIndex(0, 1, 3)).toBe(1);
    expect(nextActiveIndex(2, 1, 3)).toBe(0);
    expect(nextActiveIndex(0, -1, 3)).toBe(2);
  });
});
