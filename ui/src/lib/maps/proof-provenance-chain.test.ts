/**
 * Chaîne RÉELLE OGC → DTO → UI pour la preuve/provenance.
 *
 * On ne teste PAS un DTO fabriqué à la main : on part d'une FeatureCollection
 * telle que geo la sert (`/api/geo/collections/...`), on la fait passer par le
 * VRAI code de chargement immo — `fetchLots` (lots-client) et
 * `loadSignauxZones` → `geoZonesResponseFromCollection` (chemin OGC prioritaire
 * de la vue Signaux) — puis on rend le composant qui l'affiche.
 *
 * Couverture (revue codex) : les 4 statuts de provenance, proof complete ET
 * partial, absence d'enveloppe (= non évalué, jamais orphan),
 * historical-verified + not-ready, legacy-traceable + ready, NON-BLACKOUT
 * (zone_code / normes conservés sous orphan/candidate/not-ready), et fuites
 * (clé interne / URL privée) écartées sur le vrai chemin.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/svelte";
import LotFichePanel from "$lib/components/maps/LotFichePanel.svelte";
import Harness from "$lib/components/maps/SignauxSelPanelHarness.svelte";
import { fetchLots } from "./lots-client.js";
import { loadSignauxZones } from "./signaux-zones-loader.js";
import type { CityMapEntry } from "./maps-data.js";
import type { MunicipalityT } from "@radar/domain";

type Status = "historical-verified" | "legacy-traceable" | "candidate-needs-human-confirmation" | "orphan";

const PROVENANCE_LABEL: Record<Status, string> = {
  "historical-verified": "Vérifiée dans les dossiers historiques",
  "legacy-traceable": "Trace historique disponible",
  "candidate-needs-human-confirmation": "À confirmer par une personne",
  orphan: "Source de géométrie non reliée",
};

afterEach(() => cleanup());

// ─── Fixtures conformes aux contrats (telles que geo les sert) ───────────────

function proofV1(status: Status) {
  return {
    schema_version: "1.0",
    status: status === "historical-verified" ? "complete" : "partial",
    sources: {
      geometry: { status: "available", artifact_uri: "https://geo.example/lots.geojson", upstream_uri: null },
      regulation: { status: "unavailable", artifact_uri: null, upstream_uri: null },
    },
    zone: null,
    gaps: ["regulation_source_unavailable"],
  };
}

/** Provenance v1 conforme pour un statut ; readiness variable (axes indépendants). */
function provenance(status: Status) {
  const isHistorical = status === "historical-verified";
  const ready = status === "legacy-traceable"; // legacy-traceable + ready (contrat §9.3)
  return {
    contract: "immo-zone-lot-provenance/v1",
    assessed_at: "2026-07-22T14:00:00Z",
    lot_assignment_evidence: {
      state: "recorded",
      selected_zone: { collection: "qc-zonage-delson", feature_ref: null, code: "H-431" },
      assignment_method: "area-majority",
      dominant_fraction: 0.94,
      multi_zone: false,
      zone_codes: ["H-431"],
      evidence_snapshot: "2026-06-21",
      evidence_id: "lot-zone-ev-7d21",
      reason_codes: [],
    },
    zone_geometry_provenance: {
      status,
      zone: { collection: "qc-zonage-delson", feature_ref: null, code: "H-431" },
      public_source: isHistorical
        ? { url: "https://donnees.example.org/zonage.geojson", type: "geojson-officiel", method: "natif", retrieved_at: "2026-06-21T09:00:00Z", sha256: null }
        : null,
      verified_at: isHistorical ? "2026-07-22T13:50:00Z" : null,
      evidence_id: isHistorical ? "geom-ev-a02e" : null,
      reason_codes: status === "orphan" ? ["source-identity-unlinked"] : status === "candidate-needs-human-confirmation" ? ["needs-human-confirmation"] : ready ? ["historical-verification-unavailable"] : [],
    },
    acquisition_v2_readiness: ready
      ? { state: "ready", checked_at: "2026-07-22T14:00:00Z", unmet_requirement_codes: [] }
      : { state: "not-ready", checked_at: "2026-07-22T14:00:00Z", unmet_requirement_codes: ["missing-content-sha256"] },
  };
}

const SQUARE = {
  type: "Polygon",
  coordinates: [[[-73.6, 45.3], [-73.5, 45.3], [-73.5, 45.4], [-73.6, 45.4], [-73.6, 45.3]]],
};

/** FeatureCollection OGC lots telle que geo la sert. */
function ogcLotsBody(properties: Record<string, unknown>) {
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", geometry: SQUARE, properties: { NO_LOT: "6 057 912", noLot: "6 057 912", ...properties } }],
  };
}

/** FeatureCollection OGC zonage telle que geo la sert. */
function ogcZonesBody(properties: Record<string, unknown>) {
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", geometry: SQUARE, properties: { zone_code: "H-431", ...properties } }],
  };
}

function stubFetch(body: unknown) {
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
}

function makeCity(): CityMapEntry {
  const municipality = {
    slug: "delson", name: "Delson", mrc: "Roussillon", lat: 45.27, lon: -73.55,
    population: 11000, distanceToMtlKm: 20, priorityRank: 12,
    excluded: false, excludedReason: null, deprioritized: false,
  } as MunicipalityT;
  return { municipality, signalCount6m: 0, subsetCounts: {}, vivierV2Counts: null };
}

// ─── LOTS : OGC → fetchLots (DTO) → LotFichePanel ────────────────────────────

describe("chaîne lots OGC → fetchLots → LotFichePanel", () => {
  it.each(Object.keys(PROVENANCE_LABEL) as Status[])(
    "porte l'audit (%s) sans jamais masquer zone_code ni normes (non-blackout)",
    async (status) => {
      stubFetch(ogcLotsBody({
        zone_code: "H-431",
        normes: { hauteur: "12 m" },
        proof: proofV1(status),
        immo_zone_lot_provenance: provenance(status),
      }));
      const response = await fetchLots("delson", { baseUrl: "" });
      const lot = response.featureCollection.features[0]!;
      // Le DTO a bien porté les DEUX enveloppes validées.
      expect(lot.properties.proof).toBeDefined();
      expect(lot.properties.immo_zone_lot_provenance).toBeDefined();

      const view = render(LotFichePanel, { props: { lot } });
      // Audit rendu : statut de provenance + état de preuve.
      expect(view.getByTestId("fiche-audit")).toBeTruthy();
      expect(view.getByText(PROVENANCE_LABEL[status])).not.toBeNull();
      expect(view.getByText(status === "historical-verified" ? "Dossier de preuve complet" : "Dossier de preuve partiel")).not.toBeNull();
      // NON-BLACKOUT : le rattachement enregistré et les normes restent servis.
      expect(view.getByTestId("fiche-zone-code").textContent).toContain("H-431");
      expect(view.getByTestId("fiche-normes").textContent).toContain("12 m");
    },
  );

  it("historical-verified + not-ready : dossier incomplet + lien source publique", async () => {
    stubFetch(ogcLotsBody({ zone_code: "H-431", proof: proofV1("historical-verified"), immo_zone_lot_provenance: provenance("historical-verified") }));
    const lot = (await fetchLots("delson", { baseUrl: "" })).featureCollection.features[0]!;
    const view = render(LotFichePanel, { props: { lot } });
    expect(view.getByText("Dossier incomplet")).not.toBeNull();
    expect(view.getByTestId("fiche-geometry-source-link")).toBeTruthy();
  });

  it("legacy-traceable + ready : dossier vérifiable, pas de source publique inventée", async () => {
    stubFetch(ogcLotsBody({ zone_code: "H-431", proof: proofV1("legacy-traceable"), immo_zone_lot_provenance: provenance("legacy-traceable") }));
    const lot = (await fetchLots("delson", { baseUrl: "" })).featureCollection.features[0]!;
    const view = render(LotFichePanel, { props: { lot } });
    expect(view.getByText("Dossier vérifiable")).not.toBeNull();
    expect(view.queryByTestId("fiche-geometry-source-link")).toBeNull();
  });

  it("proof v2 : lien de source géométrique publiée porté sur le vrai chemin", async () => {
    const proofV2 = {
      schema_version: "2.0",
      geometry_source: { url: "https://donnees.example.org/zonage.geojson", type: "geojson-officiel", method: "natif", reliability: "directe", retrieved_at: "2026-06-21T09:00:00Z", sha256: null },
    };
    stubFetch(ogcLotsBody({ zone_code: "H-431", proof: proofV2 }));
    const lot = (await fetchLots("delson", { baseUrl: "" })).featureCollection.features[0]!;
    const view = render(LotFichePanel, { props: { lot } });
    expect(view.getByTestId("fiche-proof-geometry-source-link")).toBeTruthy();
  });

  it("absence d'enveloppe : non évalué (aucun bloc audit), JAMAIS orphan, zone_code conservé", async () => {
    stubFetch(ogcLotsBody({ zone_code: "H-431", normes: { hauteur: "12 m" } }));
    const lot = (await fetchLots("delson", { baseUrl: "" })).featureCollection.features[0]!;
    expect(lot.properties.proof).toBeUndefined();
    expect(lot.properties.immo_zone_lot_provenance).toBeUndefined();
    const view = render(LotFichePanel, { props: { lot } });
    expect(view.queryByTestId("fiche-audit")).toBeNull();
    expect(view.queryByText("Source de géométrie non reliée")).toBeNull(); // jamais orphan
    expect(view.getByTestId("fiche-zone-code").textContent).toContain("H-431");
  });

  it("fuite sur le vrai chemin : clé interne / URL privée / clé S3 écartées avant l'UI", async () => {
    stubFetch(ogcLotsBody({
      zone_code: "H-431",
      // proof avec artefact S3 (fuite) → rejeté en bloc.
      proof: { ...proofV1("orphan"), sources: { geometry: { status: "available", artifact_uri: "s3://radar-immobilier-raw/lots.geojson", upstream_uri: null }, regulation: { status: "unavailable", artifact_uri: null, upstream_uri: null } } },
      // provenance avec clé interne + URL minio (fuite) → rejetée en bloc.
      immo_zone_lot_provenance: {
        ...provenance("historical-verified"),
        raw_log: "internal-job-42",
        zone_geometry_provenance: { ...provenance("historical-verified").zone_geometry_provenance, public_source: { url: "http://minio.local:9000/zonage.geojson", type: "geojson-officiel", method: "natif", retrieved_at: null, sha256: null } },
      },
    }));
    const response = await fetchLots("delson", { baseUrl: "" });
    const lot = response.featureCollection.features[0]!;
    expect(lot.properties.proof).toBeUndefined();
    expect(lot.properties.immo_zone_lot_provenance).toBeUndefined();
    const view = render(LotFichePanel, { props: { lot } });
    expect(view.queryByTestId("fiche-audit")).toBeNull();
    const html = view.container.innerHTML;
    expect(html).not.toContain("s3://");
    expect(html).not.toContain("minio");
    expect(html).not.toContain("internal-job-42");
    // Le lot reste affiché (non-blackout) : zone_code toujours servi.
    expect(view.getByTestId("fiche-zone-code").textContent).toContain("H-431");
  });
});

// ─── ZONES : OGC → loadSignauxZones → geoZonesResponseFromCollection → UI ─────

describe("chaîne zones OGC (prioritaire) → loadSignauxZones → SignauxSelPanel", () => {
  async function loadZone(status: Status) {
    stubFetch(ogcZonesBody({ zone_code: "H-431", proof: proofV1(status), immo_zone_lot_provenance: provenance(status) }));
    const { response, tier } = await loadSignauxZones("delson", {});
    // On est bien sur le chemin OGC prioritaire (celui qui perdait les preuves).
    expect(tier).toBe("collection");
    return response!;
  }

  it.each(Object.keys(PROVENANCE_LABEL) as Status[])(
    "le chemin OGC porte l'audit de zone (%s) et ne masque jamais la zone (non-blackout)",
    async (status) => {
      const zonesResponse = await loadZone(status);
      // L'enveloppe validée a survécu à geoZonesResponseFromCollection.
      const props = zonesResponse.featureCollection.features[0]!.properties;
      expect(props.proof).toBeDefined();
      expect(props.immo_zone_lot_provenance).toBeDefined();

      const view = render(Harness, { props: { selectedCity: makeCity(), detailNodes: [], zonesResponse } });
      // La zone reste listée puis on ouvre sa fiche.
      const label = view.getByText("H-431", { selector: ".sel-entity-label" });
      await fireEvent.click(label);
      expect(view.getByTestId("zone-audit")).toBeTruthy();
      expect(view.getByText(PROVENANCE_LABEL[status])).not.toBeNull();
      // NON-BLACKOUT : le code de zone reste affiché dans la fiche.
      expect(view.getByText("H-431", { selector: ".sel-entity-label" })).not.toBeNull();
    },
  );

  it("historical-verified : lien source publique rendu depuis le chemin OGC", async () => {
    const zonesResponse = await loadZone("historical-verified");
    const view = render(Harness, { props: { selectedCity: makeCity(), detailNodes: [], zonesResponse } });
    await fireEvent.click(view.getByText("H-431", { selector: ".sel-entity-label" }));
    expect(view.getByTestId("zone-geometry-source-link")).toBeTruthy();
  });

  it("fuite sur le chemin OGC : URL privée / clé interne écartées avant l'UI", async () => {
    stubFetch(ogcZonesBody({
      zone_code: "H-431",
      proof: proofV1("legacy-traceable"),
      immo_zone_lot_provenance: { ...provenance("legacy-traceable"), token: "secret-42" },
    }));
    const { response } = await loadSignauxZones("delson", {});
    const props = response!.featureCollection.features[0]!.properties;
    // proof conforme conservé ; provenance qui fuit ÉCARTÉE (non tout-ou-rien).
    expect(props.proof).toBeDefined();
    expect(props.immo_zone_lot_provenance).toBeUndefined();
    const view = render(Harness, { props: { selectedCity: makeCity(), detailNodes: [], zonesResponse: response! } });
    await fireEvent.click(view.getByText("H-431", { selector: ".sel-entity-label" }));
    expect(view.container.innerHTML).not.toContain("secret-42");
    // La zone reste servie et son proof reste auditée (non-blackout).
    expect(view.getByTestId("zone-proof")).toBeTruthy();
  });
});
