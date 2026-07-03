/**
 * Harnais QA — monte SourceConsole EN ISOLATION pour prouver AU RENDU RÉEL le
 * critère corrigé du « Focus 30 » (bug Steve) : le focus = les villes À
 * SIGNAUX (`computeFocusScope`, rang par nombre de signaux), plus jamais
 * `priorityRank ≤ 30` (proximité de Montréal).
 *
 * Fixture (chiffres RÉELS mesurés sur les graphes S3 le 2026-07-03) :
 *   - Mont-Tremblant : 13 signaux, rang proximité 351 → DOIT être focus.
 *   - Saint-Eustache : 221 signaux, rang 55 → focus (rang signaux 1).
 *   - Léry           : 28 signaux, rang 35 → focus.
 *   - Kirkland (rang 30) et Brossard (rang 12) : 0 signal → JAMAIS focus,
 *     même proches (l'ancien critère les gardait à tort).
 *
 * Aucune donnée backend, aucun stack docker : données passées en dur.
 */
import "../../src/app.css";
import { mount } from "svelte";
import SourceConsole from "../../src/lib/components/sources-map/SourceConsole.svelte";
import type {
  CityCoverage,
  CoverageResponse,
} from "../../src/lib/sources/source-coverage-client.js";

const target = document.getElementById("harness-root");
if (!target) throw new Error("Missing #harness-root");

/** Ville ACTIVE (PV vérifiés) avec `signalCount` signaux projetés. */
function makeCity(
  slug: string,
  name: string,
  priorityRank: number | null,
  signalCount: number,
): CityCoverage {
  return {
    citySlug: slug,
    cityName: name,
    mrc: null,
    priorityRank,
    l1Raw: { state: "verified", count: 3, freshness: "fresh" },
    l2Graph: { state: "absent", ontologyVersion: null, freshness: "unknown" },
    signals: {
      state: signalCount > 0 ? "verified" : "absent",
      count: signalCount,
      withCitation: 0,
      freshness: signalCount > 0 ? "fresh" : "unknown",
    },
    l4Zonage: { state: "absent", served: false, servedBy: null, freshness: "unknown" },
    normes: { state: "absent", freshness: "unknown" },
    l5Lots: { state: "absent", served: false, servedBy: null, freshness: "unknown" },
    tod: { state: "absent", served: false, servedBy: null, freshness: "unknown" },
    worstStatus: "declared",
    nextMarginalGain: null,
  };
}

const CITIES: CityCoverage[] = [
  makeCity("mont-tremblant", "Mont-Tremblant", 351, 13),
  makeCity("saint-eustache", "Saint-Eustache", 55, 221),
  makeCity("lery", "Léry", 35, 28),
  makeCity("kirkland", "Kirkland", 30, 0),
  makeCity("brossard", "Brossard", 12, 0),
];

const RESPONSE: CoverageResponse = {
  generatedAt: "2026-07-03T00:00:00Z",
  totals: {
    cities: CITIES.length,
    l1Raw: CITIES.length,
    l2Graph: 0,
    signals: 3,
    l4Zonage: 0,
    l5Lots: 0,
  },
  cities: CITIES,
};

mount(SourceConsole, {
  target,
  props: {
    cities: CITIES,
    response: RESPONSE,
    loading: false,
    error: null,
    onReload: () => {},
  },
});
