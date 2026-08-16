/**
 * rail-city-items — recherche de la liste plate des rails. La liste est
 * COMPLÈTE (aucun plafond d'affichage — P02) : toute ville trouvable par la
 * recherche est présente dans la liste non filtrée, y compris la ville
 * sélectionnée (garde #378 — plus de coupe qui l'éjecte).
 */
import { describe, it, expect } from "vitest";
import { prioritizedCities } from "@radar/sources/municipalities";
import {
  filterRailCityItems,
  type RailCityItem,
} from "./rail-city-items.js";

/** Plafond historique retiré par P02 — conservé ici comme témoin de régression. */
const HISTORIC_CAP = 60;

function item(slug: string, name = slug, sublabel: string | null = null): RailCityItem {
  return {
    slug,
    name,
    sublabel,
    dotTone: "neutral",
    badge: { label: "1", tone: "warning" },
  };
}

describe("filterRailCityItems — recherche (liste complète, sans plafond)", () => {
  it("renvoie TOUS les items sans recherche (aucun plafond)", () => {
    const items = Array.from({ length: HISTORIC_CAP + 40 }, (_, i) => item(`ville-${i}`));
    expect(filterRailCityItems(items, "")).toHaveLength(HISTORIC_CAP + 40);
  });

  it("filtre par nom ou sous-libellé, insensible à la casse", () => {
    const items = [item("a", "Sutton", "Brome-Missisquoi"), item("b", "Austin", "Memphrémagog")];
    expect(filterRailCityItems(items, "sutton").map((i) => i.slug)).toEqual(["a"]);
    expect(filterRailCityItems(items, "MEMPHRÉ").map((i) => i.slug)).toEqual(["b"]);
  });

  it("une correspondance au-delà du rang de coupe historique reste renvoyée", () => {
    const items = Array.from({ length: HISTORIC_CAP + 40 }, (_, i) =>
      item(`v-${i}`, i === HISTORIC_CAP + 20 ? "Ville cible" : `Ville ${i}`),
    );
    const shown = filterRailCityItems(items, "cible");
    expect(shown.map((i) => i.slug)).toEqual([`v-${HISTORIC_CAP + 20}`]);
  });

  it("la recherche est le SEUL filtre : une requête qui écarte une ville l'exclut", () => {
    const items = [item("a", "Sutton"), item("b", "Austin")];
    expect(filterRailCityItems(items, "sutton").map((i) => i.slug)).toEqual(["a"]);
  });

  it("requête vide → liste inchangée (même référence d'items)", () => {
    const items = [item("a"), item("b")];
    expect(filterRailCityItems(items, "")).toBe(items);
  });
});

describe("filterRailCityItems — cohérence recherche ↔ liste (P02, Saint-Stanislas)", () => {
  // État RÉEL de la donnée municipalité (packages/radar-sources geo) : la vue
  // Sources/Couverture liste TOUTES les villes prioritaires, triées par
  // priorityRank. Saint-Stanislas (Des Chenaux) est éligible — excluded=false,
  // deprioritized=false, priorityRank=477 — mais siège à l'index ~471 de la
  // liste éligible, bien au-delà du plafond historique de 60. Le défaut : elle
  // n'apparaît QUE via la recherche (qui restreint l'ensemble sous le plafond),
  // JAMAIS dans la liste NON filtrée. Régression fondée sur l'état réel, pas un
  // mock arbitraire.
  const STANISLAS_SLUG = "saint-stanislas--des-chenaux";

  // Projection minimale des villes éligibles RÉELLES en items de rail, dans
  // l'ordre servi au rail (priorityRank croissant — cf. SourcesRail).
  const eligible = prioritizedCities();
  const realItems: RailCityItem[] = eligible.map((m) => ({
    slug: m.slug,
    name: m.name,
    sublabel: m.mrc ?? null,
    dotTone: "neutral",
    badge: { label: "0", tone: "neutral" },
  }));

  it("l'état RÉEL de Saint-Stanislas est éligible et situé au-delà du plafond historique", () => {
    const idx = eligible.findIndex((m) => m.slug === STANISLAS_SLUG);
    expect(idx).toBeGreaterThanOrEqual(0);
    const stanislas = eligible[idx];
    expect(stanislas.excluded).toBe(false);
    expect(stanislas.deprioritized).toBe(false);
    expect(stanislas.priorityRank).not.toBeNull();
    // Au-delà du plafond historique → autrefois invisible dans la liste non filtrée.
    expect(idx).toBeGreaterThan(HISTORIC_CAP);
  });

  it("apparaît dans la liste NON filtrée (pas seulement via la recherche)", () => {
    const unfiltered = filterRailCityItems(realItems, "");
    expect(unfiltered.some((i) => i.slug === STANISLAS_SLUG)).toBe(true);
  });

  it("recherche et liste sont cohérentes : rien que la recherche révèle n'est caché par la liste", () => {
    const found = filterRailCityItems(realItems, "Saint-Stanislas");
    // La recherche trouve bien Saint-Stanislas (Des Chenaux).
    expect(found.some((i) => i.slug === STANISLAS_SLUG)).toBe(true);
    // Toute ville trouvée par la recherche est présente dans la liste complète.
    const unfiltered = filterRailCityItems(realItems, "");
    const unfilteredSlugs = new Set(unfiltered.map((i) => i.slug));
    for (const f of found) {
      expect(unfilteredSlugs.has(f.slug)).toBe(true);
    }
  });
});
