import { render } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import LotFichePanel from "./LotFichePanel.svelte";
import type { GeometryProvenanceStatus } from "$lib/maps/geo-provenance.js";
import type { LotFeature } from "$lib/maps/lots-client.js";

const labels: Record<GeometryProvenanceStatus, string> = {
  "historical-verified": "Vérification déclarée par la source",
  "legacy-traceable": "Trace historique disponible",
  "candidate-needs-human-confirmation": "À confirmer par une personne",
  orphan: "Source de géométrie non reliée",
};

function auditLot(status: GeometryProvenanceStatus, proofStatus: "complete" | "partial"): LotFeature {
  return {
    type: "Feature",
    geometry: null,
    properties: {
      noLot: "6 057 912",
      proof: {
        schema_version: "1.0",
        status: proofStatus,
        sources: {
          geometry: { status: "available", artifact_uri: "https://geo.example/lots.geojson", upstream_uri: null },
          regulation: { status: "unavailable", artifact_uri: null, upstream_uri: null },
        },
        zone: null,
        gaps: ["regulation_source_unavailable"],
      },
      immo_zone_lot_provenance: {
        contract: "immo-zone-lot-provenance/v1",
        lot_assignment_evidence: {
          state: "recorded",
          selected_zone: { collection: "qc-zonage-delson", feature_ref: null, code: "H-12" },
          assignment_method: "area-majority",
          dominant_fraction: 0.94,
          multi_zone: false,
          reason_codes: [],
        },
        zone_geometry_provenance: {
          status,
          public_source: status === "historical-verified" ? { url: "https://ville.example/zonage.geojson" } : null,
          reason_codes: status === "orphan" ? ["source-identity-unlinked"] : [],
        },
        acquisition_v2_readiness: { state: "not-ready", unmet_requirement_codes: ["missing-content-sha256"] },
      },
    },
  };
}

describe("LotFichePanel — audit des sources", () => {
  it.each([
    ["historical-verified", "complete"],
    ["legacy-traceable", "partial"],
    ["candidate-needs-human-confirmation", "partial"],
    ["orphan", "partial"],
  ] as Array<[GeometryProvenanceStatus, "complete" | "partial"]>)("affiche le statut %s", (status, proofStatus) => {
    const view = render(LotFichePanel, { props: { lot: auditLot(status, proofStatus) } });
    expect(view.getByText(labels[status])).not.toBeNull();
    expect(view.getByText(proofStatus === "complete" ? "Dossier de preuve complet" : "Dossier de preuve partiel")).not.toBeNull();
    expect(view.getByText("Source réglementaire indisponible")).not.toBeNull();
  });

  it("keeps null sources and declared gaps honest", () => {
    const view = render(LotFichePanel, { props: { lot: auditLot("candidate-needs-human-confirmation", "partial") } });
    expect(view.queryByTestId("fiche-geometry-source-link")).toBeNull();
    expect(view.getByText("Empreinte du contenu indisponible")).not.toBeNull();
    expect(view.getByText("Plusieurs zones")).not.toBeNull();
  });

  it("keeps the audit block visible with a « Non couvert » state when no envelope is served", () => {
    const view = render(LotFichePanel, { props: { lot: { type: "Feature", geometry: null, properties: { noLot: "6 057 912" } } } });
    // Le bloc reste VISIBLE (distinction « pas de preuve » vs « fonctionnalité absente »).
    expect(view.getByTestId("fiche-audit")).toBeTruthy();
    expect(view.getByTestId("fiche-audit-empty")).toBeTruthy();
    expect(view.getByText("Non couvert")).not.toBeNull();
    expect(view.getByText("Informations de zonage non disponibles pour ce lot.")).not.toBeNull();
  });
});
