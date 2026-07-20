/**
 * rail-city-items — recherche + plafond de la liste plate des rails, et
 * l'EXEMPTION du plafond pour la ville sélectionnée (`keepSlug`, garde #378 :
 * la coupe au plafond ne doit jamais éjecter la ville sélectionnée du rail).
 */
import { describe, it, expect } from "vitest";
import {
  filterRailCityItems,
  RAIL_CITY_LIST_MAX,
  type RailCityItem,
} from "./rail-city-items.js";

function item(slug: string, name = slug, sublabel: string | null = null): RailCityItem {
  return {
    slug,
    name,
    sublabel,
    dotTone: "neutral",
    badge: { label: "1", tone: "warning" },
  };
}

describe("filterRailCityItems — recherche + plafond", () => {
  it("plafonne à max lignes sans recherche", () => {
    const items = Array.from({ length: 8 }, (_, i) => item(`ville-${i}`));
    expect(filterRailCityItems(items, "", 5)).toHaveLength(5);
  });

  it("filtre par nom ou sous-libellé, insensible à la casse", () => {
    const items = [item("a", "Sutton", "Brome-Missisquoi"), item("b", "Austin", "Memphrémagog")];
    expect(filterRailCityItems(items, "sutton", 10).map((i) => i.slug)).toEqual(["a"]);
    expect(filterRailCityItems(items, "MEMPHRÉ", 10).map((i) => i.slug)).toEqual(["b"]);
  });

  it("le plafond par défaut est RAIL_CITY_LIST_MAX", () => {
    const items = Array.from({ length: RAIL_CITY_LIST_MAX + 5 }, (_, i) => item(`v-${i}`));
    expect(filterRailCityItems(items, "")).toHaveLength(RAIL_CITY_LIST_MAX);
  });
});

describe("filterRailCityItems — keepSlug : la ville sélectionnée survit au plafond (#378)", () => {
  it("réinjecte la ville sélectionnée coupée par le plafond", () => {
    const items = Array.from({ length: 10 }, (_, i) => item(`v-${i}`));
    const shown = filterRailCityItems(items, "", 5, "v-9");
    expect(shown).toHaveLength(6);
    expect(shown.at(-1)!.slug).toBe("v-9");
  });

  it("ne duplique pas une ville sélectionnée déjà sous le plafond", () => {
    const items = Array.from({ length: 10 }, (_, i) => item(`v-${i}`));
    const shown = filterRailCityItems(items, "", 5, "v-2");
    expect(shown).toHaveLength(5);
    expect(shown.filter((i) => i.slug === "v-2")).toHaveLength(1);
  });

  it("ne réinjecte PAS une ville écartée par la RECHERCHE (filtre explicite)", () => {
    const items = [item("a", "Sutton"), item("b", "Austin")];
    const shown = filterRailCityItems(items, "sutton", 10, "b");
    expect(shown.map((i) => i.slug)).toEqual(["a"]);
  });

  it("keepSlug absent des items est ignoré sans erreur", () => {
    const items = [item("a"), item("b")];
    expect(filterRailCityItems(items, "", 1, "zzz")).toHaveLength(1);
  });
});
