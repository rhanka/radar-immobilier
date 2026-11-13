import { addToVivierFiltreCube, countVivierClassifications, type VivierFiltreCubesByClassement } from "@radar/domain";
import type { GraphSignalNode } from "../src/lib/signals/graph-signal-detail-client.js";
import type { SignalClass } from "../src/lib/signals/signal-classement.js";

export const cities = [
  { slug: "delson", name: "Delson", classes: ["pertinent", "a_surveiller", "non_classe"] },
  { slug: "brossard", name: "Brossard", classes: ["pertinent", "pertinent"] },
  { slug: "candiac", name: "Candiac", classes: ["a_surveiller"] },
  { slug: "chateauguay", name: "Châteauguay", classes: ["non_classe", "non_classe"] },
] satisfies { slug: string; name: string; classes: SignalClass[] }[];

export function nodesFor(city: typeof cities[number]): GraphSignalNode[] {
  return city.classes.map((classe, i) => ({
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
}

export function aggregate(city: typeof cities[number]) {
  const nodes = nodesFor(city);
  const filtreCube = {};
  const filtreCubesByClassement: VivierFiltreCubesByClassement = {
    pertinent: {}, a_surveiller: {}, non_classe: {}, ecarte: { "11100": 1 },
  };
  nodes.forEach((node, i) => {
    const record = { ...node, classification: node.classification! };
    addToVivierFiltreCube(filtreCube, record);
    addToVivierFiltreCube(filtreCubesByClassement[city.classes[i]!], record);
  });
  return { citySlug: city.slug, signalCount: nodes.length, subsetCounts: {},
    vivierV2Counts: countVivierClassifications(nodes.map((node) => node.classification!)),
    filtreCube, filtreCubesByClassement };
}

export function detail(city: typeof cities[number]) {
  return { ok: true, token: "fixture", signals: nodesFor(city), heads: [],
    counts: { total: city.classes.length, hidden: 0, visible: city.classes.length, selected: 0 },
    selection: city.classes.flatMap((classe, i) => classe === "non_classe" ? [] : [{
      target: { citySlug: city.slug, type: "Signal", id: `${city.slug}-${i}` },
      facet: "selection", basket: classe, state: "active", reasonCode: null,
    }]),
  };
}
