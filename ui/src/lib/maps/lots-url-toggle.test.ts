/**
 * Deep-link ZONES-ONLY — parsing du toggle lots depuis l'URL.
 *
 * Contrat : `?lots=0|off|false|no` (insensible à la casse/espaces) ou
 * `?layers=zones` désactivent les lots ; toute autre valeur ou l'absence du
 * paramètre = lots ACTIVÉS (défaut inchangé). Pur, aucun DOM.
 */
import { describe, it, expect } from "vitest";
import { lotsEnabledFromSearch } from "./lots-url-toggle.js";

describe("lotsEnabledFromSearch — valeurs OFF (lots désactivés)", () => {
  for (const value of ["0", "off", "false", "no"]) {
    it(`?lots=${value} → lots désactivés`, () => {
      expect(lotsEnabledFromSearch(`?lots=${value}`)).toBe(false);
    });
  }

  it("insensible à la casse et aux espaces (?lots=OFF, ? lots= No )", () => {
    expect(lotsEnabledFromSearch("?lots=OFF")).toBe(false);
    expect(lotsEnabledFromSearch("?lots=%20No%20")).toBe(false);
    expect(lotsEnabledFromSearch("?lots=False")).toBe(false);
  });

  it("alias ?layers=zones → lots désactivés", () => {
    expect(lotsEnabledFromSearch("?layers=zones")).toBe(false);
    expect(lotsEnabledFromSearch("?layers=ZONES")).toBe(false);
  });

  it("OFF combiné à d'autres paramètres d'URL", () => {
    expect(lotsEnabledFromSearch("?mode=signal&lots=0")).toBe(false);
    expect(lotsEnabledFromSearch("?mode=signal&layers=zones")).toBe(false);
  });
});

describe("lotsEnabledFromSearch — défaut ACTIVÉ (comportement inchangé)", () => {
  it("aucun paramètre (chaîne vide) → lots activés", () => {
    expect(lotsEnabledFromSearch("")).toBe(true);
    expect(lotsEnabledFromSearch("?")).toBe(true);
  });

  it("paramètres sans `lots`/`layers` → lots activés", () => {
    expect(lotsEnabledFromSearch("?mode=signal")).toBe(true);
    expect(lotsEnabledFromSearch("?mode=signal&filter.subset=z")).toBe(true);
  });

  it("valeurs ON explicites ou non reconnues → lots activés", () => {
    expect(lotsEnabledFromSearch("?lots=1")).toBe(true);
    expect(lotsEnabledFromSearch("?lots=on")).toBe(true);
    expect(lotsEnabledFromSearch("?lots=true")).toBe(true);
    expect(lotsEnabledFromSearch("?lots=yes")).toBe(true);
    expect(lotsEnabledFromSearch("?lots=")).toBe(true);
    expect(lotsEnabledFromSearch("?lots=whatever")).toBe(true);
  });

  it("`layers` autre que zones → lots activés", () => {
    expect(lotsEnabledFromSearch("?layers=all")).toBe(true);
    expect(lotsEnabledFromSearch("?layers=lots")).toBe(true);
  });
});
