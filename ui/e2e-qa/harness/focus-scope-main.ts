/**
 * Harnais QA — monte SourceConsole EN ISOLATION pour prouver AU RENDU RÉEL le
 * critère corrigé du focus : le focus = les villes portant les signaux
 * PRIORITAIRES z∩m∩p (zonage ∩ multifamilial 4+ ∩ précoce — la cohorte « 33 »
 * de l'axe « 30 villes / 33 signaux précoces », `computeFocusScope`).
 * Ni `priorityRank ≤ 30` (proximité de Montréal — 1er bug, Steve), ni top 30
 * par NOMBRE de signaux (2e bug : le volume brut n'est pas le critère).
 *
 * Fixture (chiffres RÉELS mesurés sur les graphes S3 canoniques le 2026-07-03 —
 * 33 signaux prioritaires z∩m∩p portés par 31 villes) :
 *   - Mont-Tremblant : 2 signaux prioritaires (rang 1 du focus), 13 signaux,
 *     rang proximité 351 → DOIT être focus.
 *   - Sainte-Catherine : 1 prioritaire, 16 signaux → focus.
 *   - Saint-Amable    : 1 prioritaire, 15 signaux → focus.
 *   - Lyster : 400 signaux mais 0 prioritaire → JAMAIS focus (pas un top-N).
 *   - Kirkland (rang 30) et Brossard (rang 12) : 0 signal → JAMAIS focus,
 *     même proches (l'ancien critère proximité les gardait à tort).
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

/** Ville ACTIVE (PV vérifiés) : `signalCount` signaux dont `priority` z∩m∩p. */
function makeCity(
  slug: string,
  name: string,
  priorityRank: number | null,
  signalCount: number,
  priority: number,
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
      priority,
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
  makeCity("mont-tremblant", "Mont-Tremblant", 351, 13, 2),
  makeCity("sainte-catherine", "Sainte-Catherine", 20, 16, 1),
  makeCity("saint-amable", "Saint-Amable", 61, 15, 1),
  makeCity("lyster", "Lyster", 550, 400, 0),
  makeCity("kirkland", "Kirkland", 30, 0, 0),
  makeCity("brossard", "Brossard", 12, 0, 0),
];

const RESPONSE: CoverageResponse = {
  generatedAt: "2026-07-03T00:00:00Z",
  totals: {
    cities: CITIES.length,
    l1Raw: CITIES.length,
    l2Graph: 0,
    signals: 4,
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
