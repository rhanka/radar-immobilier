import { describe, expect, it } from "vitest";
import { buildGeoViewFeatures, type GeoFeaturesResponse } from "./geo-client.js";
import {
  GEO_OPPORTUNITE_DETAIL_SCHEMA,
  GEO_ZONE_DETAIL_SCHEMA,
} from "./geo-categories.js";

const response: GeoFeaturesResponse = {
  ok: true,
  citySlug: "sainte-martine",
  zoneCount: 2,
  lotCount: 0,
  opportuniteCount: 2,
  zones: {
    type: "FeatureCollection",
    features: [
      { type: "Feature", geometry: null, properties: { featureKind: "zone", anticipation: "adoption", regulatoryStatus: "anticipation" } },
      { type: "Feature", geometry: null, properties: { featureKind: "zone", anticipation: null, regulatoryStatus: "firm" } },
    ],
  },
  lots: { type: "FeatureCollection", features: [] },
  opportunites: {
    type: "FeatureCollection",
    features: [
      { type: "Feature", geometry: null, properties: { featureKind: "opportunite", etape: "adoption", regulatoryStatus: "anticipation" } },
      { type: "Feature", geometry: null, properties: { featureKind: "opportunite", etape: "avis_motion", regulatoryStatus: "firm" } },
    ],
  },
};

describe("D5-géo — marquage regulatoryStatus servi", () => {
  const features = buildGeoViewFeatures(response);

  it("lit le statut zone servi sans le re-classifier depuis l'étape", () => {
    expect(features[0]!.properties).toMatchObject({
      regulatoryStatus: "anticipation",
      regulatoryMarking: "Anticipation",
    });
    expect(features[0]!.properties.regulatoryMarking).not.toBe("Ferme");
    expect(features[1]!.properties).toMatchObject({
      regulatoryStatus: "firm",
      regulatoryMarking: "Ferme",
    });
  });

  it("respecte le marquage servi par nœud même quand etape le contredit", () => {
    expect(features[2]!.properties.regulatoryMarking).toBe("Anticipation");
    expect(features[2]!.properties.regulatoryMarking).not.toBe("Ferme");
    expect(features[3]!.properties.regulatoryMarking).toBe("Ferme");
  });

  it("surface le marquage sans remplacer le champ d'étape réglementaire", () => {
    for (const schema of [GEO_ZONE_DETAIL_SCHEMA, GEO_OPPORTUNITE_DETAIL_SCHEMA]) {
      expect(schema.fields).toEqual(expect.arrayContaining([
        expect.objectContaining({ key: "regulatoryMarking", labelFr: "Marquage réglementaire" }),
      ]));
    }
    expect(GEO_ZONE_DETAIL_SCHEMA.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "anticipation", labelFr: "Étape réglementaire" }),
    ]));
    expect(GEO_OPPORTUNITE_DETAIL_SCHEMA.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "etape", labelFr: "Étape" }),
    ]));
  });
});
