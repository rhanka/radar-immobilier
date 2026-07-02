/**
 * Tests du JOIN pur lot↔zone (lot-zone-join).
 *
 * Vérifie : construction d'index, normalisation d'appariement (H-104 ↔ H104),
 * placeholders jamais matchés, enrichissement non destructif (les valeurs API
 * du lot gardent priorité), et pass-through identitaire sans join.
 */
import { describe, it, expect } from "vitest";
import {
  buildZoneIndex,
  lotZoneKey,
  zoneForLot,
  enrichLotWithZone,
} from "./lot-zone-join.js";
import type { ZoneFeature } from "./zones-client.js";
import type { LotFeature } from "./lots-client.js";

function makeZone(code: string, extra: Partial<ZoneFeature["properties"]> = {}): ZoneFeature {
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [[[-73.55, 45.37], [-73.54, 45.37], [-73.54, 45.38], [-73.55, 45.37]]],
    },
    properties: { code, citySlug: "delson", ...extra },
  };
}

function makeLot(props: Partial<LotFeature["properties"]> = {}): LotFeature {
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [[[-73.55, 45.37], [-73.549, 45.37], [-73.549, 45.371], [-73.55, 45.37]]],
    },
    properties: { noLot: "2 181 127", citySlug: "delson", ...props },
  };
}

describe("lotZoneKey", () => {
  it("normalise le code de zone du lot (casse, tirets, espaces)", () => {
    expect(lotZoneKey({ noLot: "1", zoneCode: "H-104" })).toBe(
      lotZoneKey({ noLot: "2", zoneCode: "h104" }),
    );
  });

  it("retourne null pour un code absent ou placeholder", () => {
    expect(lotZoneKey({ noLot: "1" })).toBeNull();
    expect(lotZoneKey({ noLot: "1", zoneCode: null })).toBeNull();
    expect(lotZoneKey({ noLot: "1", zoneCode: "N/D" })).toBeNull();
    expect(lotZoneKey({ noLot: "1", zoneCode: "n/a" })).toBeNull();
    expect(lotZoneKey({ noLot: "1", zoneCode: "-" })).toBeNull();
  });

  it("retombe sur zone.code quand zoneCode est absent", () => {
    const key = lotZoneKey({
      noLot: "1",
      zone: { kind: "H", usages: [], densiteLogHa: null, code: "H-104" },
    });
    expect(key).toBe(lotZoneKey({ noLot: "2", zoneCode: "H-104" }));
  });
});

describe("buildZoneIndex + zoneForLot", () => {
  it("joint un lot à sa zone par code normalisé (H-104 ↔ H104)", () => {
    const index = buildZoneIndex([makeZone("H-104", { kind: "Résidentielle" })]);
    const lot = makeLot({ zoneCode: "H104" });
    const joined = zoneForLot(lot.properties, index);
    expect(joined?.properties.code).toBe("H-104");
    expect(joined?.properties.kind).toBe("Résidentielle");
  });

  it("ne matche jamais un lot sans code ou placeholder", () => {
    const index = buildZoneIndex([makeZone("H-104")]);
    expect(zoneForLot(makeLot().properties, index)).toBeNull();
    expect(zoneForLot(makeLot({ zoneCode: "N/D" }).properties, index)).toBeNull();
  });

  it("préfère la feature de zone la plus renseignée en cas de doublon", () => {
    const bare = makeZone("C-18");
    const rich = makeZone("C-18", { kind: "Commerciale", grillePdfUrl: "https://x/c18.pdf" });
    const index = buildZoneIndex([bare, rich]);
    expect(index.size).toBe(1);
    expect(zoneForLot(makeLot({ zoneCode: "C-18" }).properties, index)?.properties.kind).toBe(
      "Commerciale",
    );
  });
});

describe("enrichLotWithZone", () => {
  it("remplit zone (code, kind, usages, grillePdfUrl) depuis la couche zonage", () => {
    const index = buildZoneIndex([
      makeZone("H-104", {
        kind: "Résidentielle",
        usages: ["habitation"],
        grillePdfUrl: "https://x/h104.pdf",
      }),
    ]);
    const enriched = enrichLotWithZone(makeLot({ zoneCode: "H-104" }), index);
    expect(enriched.properties.zone).toEqual({
      kind: "Résidentielle",
      usages: ["habitation"],
      densiteLogHa: null,
      code: "H-104",
      grillePdfUrl: "https://x/h104.pdf",
    });
    expect(enriched.properties.grillePdfUrl).toBe("https://x/h104.pdf");
  });

  it("garde la priorité aux valeurs API déjà portées par le lot", () => {
    const index = buildZoneIndex([
      makeZone("H-104", { kind: "Layer", usages: ["layer"], grillePdfUrl: "https://layer/x.pdf" }),
    ]);
    const lot = makeLot({
      zoneCode: "H-104",
      zone: {
        kind: "H",
        usages: ["habitation unifamiliale"],
        densiteLogHa: 25,
        grillePdfUrl: "https://api/h104.pdf",
      },
      grillePdfUrl: "https://api/h104.pdf",
    });
    const enriched = enrichLotWithZone(lot, index);
    expect(enriched.properties.zone?.kind).toBe("H");
    expect(enriched.properties.zone?.usages).toEqual(["habitation unifamiliale"]);
    expect(enriched.properties.zone?.densiteLogHa).toBe(25);
    expect(enriched.properties.zone?.grillePdfUrl).toBe("https://api/h104.pdf");
    expect(enriched.properties.zone?.code).toBe("H-104");
  });

  it("retourne le lot TEL QUEL (même référence) sans join", () => {
    const index = buildZoneIndex([makeZone("H-104")]);
    const lot = makeLot({ zoneCode: "Z-999" });
    expect(enrichLotWithZone(lot, index)).toBe(lot);
  });

  it("complète un zone partiel API (kind 'non précisé') depuis la couche", () => {
    const index = buildZoneIndex([makeZone("H-104", { kind: "Résidentielle" })]);
    const lot = makeLot({
      zoneCode: "H-104",
      zone: { kind: "non précisé", usages: [], densiteLogHa: null },
    });
    const enriched = enrichLotWithZone(lot, index);
    expect(enriched.properties.zone?.kind).toBe("Résidentielle");
  });
});
