/**
 * Harnais QA — monte SignauxSelPanel (panneau de droite) EN ISOLATION pour
 * prouver l'affichage de l'ID du signal + pastille couleur + badge « N sur ce
 * PV » dans la fiche (LOT 2 #84). Deux signaux partagent le MÊME rawRef (même
 * procès-verbal) → la fiche du 1er doit montrer « +1 sur ce PV ».
 *
 * Aucune donnée backend, aucun stack docker : on passe `detailNodes` en dur et
 * on pré-focus le 1er signal via `selectionState`.
 */
import "../../src/app.css";
import { mount } from "svelte";
import SignauxSelPanel from "../../src/lib/components/maps/SignauxSelPanel.svelte";
import type { CityMapEntry } from "../../src/lib/maps/maps-data.js";
import type { GraphSignalNode } from "../../src/lib/signals/graph-signal-detail-client.js";
import {
  createSelectionBucketState,
  makeKey,
  setFocus,
  toggleSelection,
  type SelectionBucketState,
  type SelectionKey,
} from "../../src/lib/maps/selection-bucket.js";

const target = document.getElementById("harness-root");
if (!target) throw new Error("Missing #harness-root");

// rawRef partagé par les deux signaux = même PV.
const RAW_REF = "raw/proces-verbaux-saint-frederic/2026/cas/abc123.pdf";

// #94 — mode QA piloté par la query string :
//   ?evidence=none → signal SANS aucune source documentaire (ni rawRef, ni
//     sourceUrl, ni sourceRef) → la fiche doit afficher l'état HONNÊTE « preuve
//     non disponible » À LA PLACE du bouton mort. Défaut (absent) : comportement
//     historique #84 (rawRef présent → bouton « Voir la preuve » actif).
const params = new URLSearchParams(window.location.search);
const evidenceMode = params.get("evidence");
const withoutEvidence = evidenceMode === "none";

function signal(id: string, label: string, description: string): GraphSignalNode {
  return {
    id,
    type: "DesignationEvent",
    label,
    citySlug: "saint-frederic",
    // Sans preuve : aucune source documentaire reliée (sourceRef null + props
    // dépourvues de rawRef/sourceUrl/documentUrl).
    sourceRef: withoutEvidence ? null : RAW_REF,
    createdAt: "2026-05-19T12:00:00.000Z",
    description,
    publishedAt: "2026-05-19T12:00:00.000Z",
    props: withoutEvidence
      ? { description, page: 2 }
      : { description, rawRef: RAW_REF, page: 2 },
  };
}

const detailNodes: GraphSignalNode[] = [
  signal("sig-A16", "Règlement A16 — hauteur", "Premier signal du PV (A16)."),
  signal("sig-Rf51", "Refonte Rf51 — urbanisme", "Second signal du même PV (Rf51)."),
];

// #2b — mode QA « preuve publique » : ?proof=public injecte une sourceUrl
// object-storage PUBLIC (VPlus, re-autorisée par la whitelist signature-based)
// sur le 1er signal → le lien de preuve DIRECT s'affiche (en plus de l'archive
// rawRef). Sert à prouver le CLIC→OUVERTURE en vrai navigateur.
const PUBLIC_PROOF_URL =
  "https://vplus-documents.s3.ca-central-1.amazonaws.com/batiscan/_publication/fichiers/pv.pdf";
if (params.get("proof") === "public" && !withoutEvidence) {
  detailNodes[0]!.props = { ...detailNodes[0]!.props, sourceUrl: PUBLIC_PROOF_URL };
}

const selectedCity: CityMapEntry = {
  municipality: {
    slug: "saint-frederic",
    name: "Saint-Frédéric",
    mrc: "Beauce",
    lat: 46.3,
    lon: -70.9,
    population: 1100,
    distanceToMtlKm: 220,
    priorityRank: 50,
    excluded: false,
    excludedReason: null,
    deprioritized: false,
  },
  signalCount6m: 2,
  subsetCounts: {},
};

// Pré-focus le 1er signal pour ouvrir sa fiche au montage.
const firstKey = makeKey("signal", "sig-A16") as SelectionKey;
let selectionState: SelectionBucketState = createSelectionBucketState();
selectionState = toggleSelection(selectionState, firstKey);
selectionState = setFocus(selectionState, firstKey);

function toggleBucketKey(key: SelectionKey): void {
  const isFocused = selectionState.focusedKey === key;
  if (isFocused) {
    selectionState = setFocus(selectionState, null);
  } else {
    if (!selectionState.selectedKeys.has(key)) {
      selectionState = toggleSelection(selectionState, key);
    }
    selectionState = setFocus(selectionState, key);
  }
}

// #3 — mode QA « règlement par zone » : ?fixture=zone-reglement monte le panneau
// avec une zone Delson H-315 focalisée qui porte un `reglementNumero` + une
// `reglementUrl` PUBLIQUE (état enrichi consommé par la fiche : geo 901 + grille
// PDF, ou source du graphe-signal). Prouve le rendu « Règl. … » + lien « Ouvrir
// le règlement » en vrai navigateur. Sans le param : comportement historique #84.
if (params.get("fixture") === "zone-reglement") {
  const citySlug = "delson";
  const reglementUrl =
    "https://ville.delson.qc.ca/wp-content/uploads/2025/01/Grilles-Web-09092022.pdf";
  const zoneFeature = {
    type: "Feature" as const,
    geometry: null,
    properties: {
      code: "H-315",
      citySlug,
      geometryStatus: "official" as const,
      confidence: 1,
      source: "official-zone" as const,
      lotCount: 17,
      lots: [],
      kind: "residential",
      reglementNumero: "901",
      reglementUrl,
    },
  };
  const zonesResponse = {
    ok: true,
    citySlug,
    source: "official" as const,
    resolutionStatus: "official" as const,
    geometryStatus: "official" as const,
    zoneCount: 1,
    warnings: [] as string[],
    featureCollection: { type: "FeatureCollection" as const, features: [zoneFeature] },
  };
  const zoneCity: CityMapEntry = {
    ...selectedCity,
    municipality: { ...selectedCity.municipality, slug: citySlug, name: "Delson" },
  };
  const zoneFocusKey = makeKey("zone", `${citySlug}/H-315`) as SelectionKey;
  let zoneState: SelectionBucketState = createSelectionBucketState();
  zoneState = toggleSelection(zoneState, zoneFocusKey);
  zoneState = setFocus(zoneState, zoneFocusKey);
  mount(SignauxSelPanel, {
    target,
    props: {
      selectedCity: zoneCity,
      detailNodes: [],
      zonesResponse,
      selectionState: zoneState,
      onToggleKey: toggleBucketKey,
    },
  });
} else {
  mount(SignauxSelPanel, {
    target,
    props: {
      selectedCity,
      detailNodes,
      selectionState,
      onToggleKey: toggleBucketKey,
    },
  });
}
