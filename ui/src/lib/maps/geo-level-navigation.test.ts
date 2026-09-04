import { describe, expect, it } from "vitest";
import {
  resolveGeoLotClick,
  resolveLotListClickR1,
} from "./geo-level-navigation.js";

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

describe("resolveLotListClickR1 — clic LISTE lot gaté par R1 (plus strict que la carte)", () => {
  it("lot dans la zone active (lotZone === active) → sélection lot", () => {
    expect(
      resolveLotListClickR1({ activeZoneCode: "H-104", lotZoneCode: "H-104" }),
    ).toEqual({ kind: "select-lot" });
  });

  it("zone active MAIS zone du lot inconnue → sélection lot (parité vue zone)", () => {
    expect(
      resolveLotListClickR1({ activeZoneCode: "H-104", lotZoneCode: null }),
    ).toEqual({ kind: "select-lot" });
  });

  it("lot d'une AUTRE zone que l'active → bascule vers la zone du lot (switch), jamais le lot", () => {
    expect(
      resolveLotListClickR1({ activeZoneCode: "H-104", lotZoneCode: "C-02" }),
    ).toEqual({ kind: "switch-zone", code: "C-02" });
  });

  it("niveau ville (aucune zone active) + zone du lot connue → bascule vers cette zone (drill)", () => {
    expect(
      resolveLotListClickR1({ activeZoneCode: null, lotZoneCode: "H-104" }),
    ).toEqual({ kind: "switch-zone", code: "H-104" });
  });

  it("niveau ville sans zone résoluble → ignore (jamais un lot hors zone active)", () => {
    expect(
      resolveLotListClickR1({ activeZoneCode: null, lotZoneCode: null }),
    ).toEqual({ kind: "ignore" });
  });
});
