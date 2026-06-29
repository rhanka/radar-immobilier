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

mount(SignauxSelPanel, {
  target,
  props: {
    selectedCity,
    detailNodes,
    selectionState,
    onToggleKey: toggleBucketKey,
  },
});
