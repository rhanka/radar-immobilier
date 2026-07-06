/**
 * Harnais QA — monte DEUX SourceScorecard EN ISOLATION pour prouver AU RENDU
 * RÉEL la section « Cohérence E2E » (WP3 LOT1) :
 *   - #harness-measured   : ville focus-30 avec un snapshot batch réel
 *     (`/api/source/consistency` mocké par le spec Playwright).
 *   - #harness-unmeasured : ville ABSENTE du snapshot -> « Non mesuré »
 *     honnête (même réponse mockée, cette ville n'y figure simplement pas).
 *
 * Les DONNÉES DE COUVERTURE (props `city`) sont des fixtures locales — seule
 * la section Cohérence E2E dépend du réseau (fetch réel intercepté par le
 * spec), exactement comme en production (fetch unique partagé, batch PG).
 */
import "../../src/app.css";
import { mount } from "svelte";
import SourceScorecard from "../../src/lib/components/sources-map/SourceScorecard.svelte";
import type { CityCoverage } from "../../src/lib/sources/source-coverage-client.js";

function makeCity(slug: string, name: string): CityCoverage {
  return {
    citySlug: slug,
    cityName: name,
    mrc: "Les Laurentides",
    priorityRank: 12,
    l1Raw: { state: "verified", count: 4, freshness: "fresh" },
    l2Graph: { state: "verified", ontologyVersion: "2.3", freshness: "fresh" },
    signals: {
      state: "verified",
      count: 20,
      withCitation: 20,
      priority: 3,
      freshness: "fresh",
    },
    l4Zonage: { state: "verified", served: true, servedBy: "geo", freshness: "fresh" },
    normes: { state: "absent", freshness: "unknown" },
    l5Lots: { state: "verified", served: true, servedBy: "geo", freshness: "fresh" },
    lotFields: { state: "absent", freshness: "unknown" },
    tod: { state: "absent", served: false, servedBy: null, freshness: "unknown" },
    worstStatus: "verified",
    nextMarginalGain: null,
  };
}

const measuredRoot = document.getElementById("harness-measured");
const unmeasuredRoot = document.getElementById("harness-unmeasured");
if (!measuredRoot || !unmeasuredRoot) throw new Error("Missing harness roots");

mount(SourceScorecard, {
  target: measuredRoot,
  props: { city: makeCity("mont-tremblant", "Mont-Tremblant") },
});

mount(SourceScorecard, {
  target: unmeasuredRoot,
  props: { city: makeCity("ville-hors-focus30", "Ville Hors Focus 30") },
});
