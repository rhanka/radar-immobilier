import { describe, expect, it } from "vitest";
import { resolveGeoLotClick } from "./geo-level-navigation.js";

describe("resolveGeoLotClick — clic carte lot gaté par le niveau (nav-drill)", () => {
  it("vue VILLE (pas de zone) : résout vers la zone contenante du lot", () => {
    expect(resolveGeoLotClick({ hasZoneSelection: false, zoneCode: "H-104" })).toEqual({
      kind: "enter-zone",
      code: "H-104",
    });
  });

  it("vue ZONE (zone entrée) : sélectionne le lot (drawer, zone reste active)", () => {
    expect(resolveGeoLotClick({ hasZoneSelection: true, zoneCode: "H-104" })).toEqual({
      kind: "select-lot",
    });
  });

  it("vue ZONE : sélection lot même sans zoneCode connu (déjà en vue zone)", () => {
    expect(resolveGeoLotClick({ hasZoneSelection: true, zoneCode: null })).toEqual({
      kind: "select-lot",
    });
  });

  it("vue VILLE sans zone dérivable : neutre (jamais une sélection lot)", () => {
    expect(resolveGeoLotClick({ hasZoneSelection: false, zoneCode: null })).toEqual({
      kind: "ignore",
    });
  });
});
