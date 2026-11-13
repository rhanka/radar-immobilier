import { addToVivierFiltreCube, applyVivierBExclusions, countVivierClassifications, matchesDocumentDateWindow, type VivierFiltreCubesByClassement } from "@radar/domain";
import type { GraphSignalNode } from "../src/lib/signals/graph-signal-detail-client.js";
import type { SignalClass } from "../src/lib/signals/signal-classement.js";

export const cities = [
  { slug: "delson", name: "Delson", classes: ["pertinent", "a_surveiller", "non_classe"] },
  { slug: "brossard", name: "Brossard", classes: ["pertinent", "pertinent"] },
  { slug: "candiac", name: "Candiac", classes: ["a_surveiller"] },
  { slug: "chateauguay", name: "Châteauguay", classes: ["non_classe", "non_classe"] },
] satisfies { slug: string; name: string; classes: SignalClass[] }[];

export function nodesFor(city: typeof cities[number]): GraphSignalNode[] {
  const nodes: GraphSignalNode[] = city.classes.map((classe, i) => ({
    id: `${city.slug}-${i}`, type: "Signal", label: `${city.name} ${classe} ${i}`,
    citySlug: city.slug, sourceRef: null, createdAt: "2026-11-01T12:00:00Z",
    publishedAt: "2026-11-01T12:00:00Z", props: { date: "2026-11-01" },
    classification: {
      zonage: { valeur: "oui", source: "fixture", confiance: 1 },
      residentiel: { valeur: "oui", source: "fixture", confiance: 1 },
      effet_densifiant: "inconnu", instrument: "rezonage", etape: "avis_motion",
      etapes_historique: ["avis_motion"], exclusion_reason: null,
      provenance: { extrait: "fixture" }, confiance: 1,
    },
  }));
  if (city.slug === "delson") {
    nodes.push({ ...nodes[0]!, id: "delson-late", label: "Late pertinent",
      classification: { ...nodes[0]!.classification!, etape: "adoption" } });
    nodes.push({ ...nodes[0]!, id: "delson-derog", label: "Derogation pertinent",
      classification: { ...nodes[0]!.classification!, instrument: "derogation" } });
  }
  return nodes;
}

export function aggregate(city: typeof cities[number], params: URLSearchParams) {
  const nodes = nodesFor(city).filter((node) => matchesDocumentDateWindow(node.props, {
    dateFrom: params.get("dateFrom") ?? undefined, dateTo: params.get("dateTo") ?? undefined,
  }));
  const filtreCube = {};
  const filtreCubesByClassement: VivierFiltreCubesByClassement = {
    pertinent: {}, a_surveiller: {}, non_classe: {}, ecarte: { "11100": 1 },
  };
  nodes.forEach((node, i) => {
    const record = { ...node, classification: node.classification! };
    addToVivierFiltreCube(filtreCube, record);
    addToVivierFiltreCube(filtreCubesByClassement[city.classes[i] ?? "pertinent"], record);
  });
  return { citySlug: city.slug, signalCount: nodes.length, subsetCounts: {},
    vivierV2Counts: countVivierClassifications(applyVivierBExclusions(nodes, {
      piiaSansProjetResidentiel: params.get("excludePiia") === "1",
      derogationsMineures: params.get("excludeDerogations") === "1",
    }).map((node) => node.classification!)),
    filtreCube, filtreCubesByClassement };
}

export function detail(city: typeof cities[number]) {
  return { ok: true, token: "fixture", signals: nodesFor(city), heads: [],
    counts: { total: city.classes.length, hidden: 0, visible: city.classes.length, selected: 0 },
    selection: nodesFor(city).flatMap((node, i) => (city.classes[i] ?? "pertinent") === "non_classe" ? [] : [{
      target: { citySlug: city.slug, type: "Signal", id: node.id },
      facet: "selection", basket: city.classes[i] ?? "pertinent", state: "active", reasonCode: null,
    }]),
  };
}
