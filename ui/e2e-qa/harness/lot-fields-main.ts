/**
 * Harnais QA — monte SourceConsole EN ISOLATION pour prouver AU RENDU RÉEL les
 * indicateurs « Champs lot » (superficie / adresse / code postal / normes
 * foldées) : colonne Console + lignes détaillées de la scorecard.
 *
 * Les DONNÉES de mesure ne sont PAS fabriquées ici : le spec Playwright
 * intercepte `/api/source/coverage/:city/lot-fields` et le sert via le VRAI
 * service `lot-fields-coverage` (api/src/services/geo) exécuté LIVE contre
 * l'API geo — mêmes chiffres que la production. Seule la LISTE de villes est
 * une fixture (Delson enrichie vs Mont-Tremblant non enrichie, lots servis
 * par geo dans les deux cas — état réel du listing live 2026-07-05).
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

/** Ville avec lots SERVIS live par geo (état réel des deux villes QA). */
function makeCity(slug: string, name: string, mrc: string): CityCoverage {
  return {
    citySlug: slug,
    cityName: name,
    mrc,
    priorityRank: null,
    l1Raw: { state: "absent", count: 0, freshness: "unknown" },
    l2Graph: { state: "absent", ontologyVersion: null, freshness: "unknown" },
    signals: {
      state: "absent",
      count: 0,
      withCitation: 0,
      priority: 0,
      freshness: "unknown",
    },
    l4Zonage: { state: "absent", served: false, servedBy: null, freshness: "unknown" },
    normes: { state: "absent", freshness: "unknown" },
    l5Lots: { state: "verified", served: true, servedBy: "geo", freshness: "fresh" },
    // Bulk froid honnête : la cellule « Champs lot » reste absent tant que la
    // mesure lazy n'a pas tourné (même contrat que la production).
    lotFields: { state: "absent", freshness: "unknown" },
    tod: { state: "absent", served: false, servedBy: null, freshness: "unknown" },
    worstStatus: "declared",
    nextMarginalGain: null,
  };
}

const CITIES: CityCoverage[] = [
  makeCity("delson", "Delson", "Roussillon"),
  makeCity("mont-tremblant", "Mont-Tremblant", "Les Laurentides"),
];

const RESPONSE: CoverageResponse = {
  generatedAt: new Date().toISOString(),
  totals: {
    cities: CITIES.length,
    l1Raw: 0,
    l2Graph: 0,
    signals: 0,
    l4Zonage: 0,
    l5Lots: CITIES.length,
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
