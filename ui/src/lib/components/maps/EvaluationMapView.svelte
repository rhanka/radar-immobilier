<script lang="ts">
  /**
   * EvaluationMapView — Vue Évaluation (maille zone/lots) — WP B slice-2.
   *
   * Drilldown zone→lot : sélection d'une ville (parmi celles avec source lots
   * donnees-quebec ET/OU changements de zonage) → charge simultanément :
   *   1. Les lots cadastraux réels (MRNF) via GET /api/geo/:city/lots
   *   2. Les changements de zonage réels via GET /api/signals/:city/detail
   *
   * CS-L6 : les 4 villes Steve (delson, sainte-catherine, saint-constant, candiac)
   * retournent mode:"carte-steve" depuis l'API. La palette de couleurs Steve est
   * appliquée (orange 4+∩TOD, vert 4+, bleu TOD, gris). Un switch source permet
   * de basculer entre Steve et MRNF.
   *
   * Anti-PII (Loi 25) : seul `noLot` (NO_LOT du cadastre allégé) est affiché.
   * Aucune donnée propriétaire, aucun owner, aucun nom de personne.
   */
  import { onMount } from "svelte";
  import {
    BarChart3,
    MapPin,
    Info,
    ChevronRight,
    AlertCircle,
    RefreshCw,
    Layers,
    FileText,
  } from "@lucide/svelte";
  import { Badge, Alert } from "@sentropic/design-system-svelte";
  import ViewLayout from "$lib/components/ViewLayout.svelte";
  import {
    SIGNAL_TYPE_LABEL,
    CONFIDENCE_TONE,
    PILOT_CITY_SLUG,
  } from "$lib/maps/maps-data.js";
  import { fetchLots, type LotFeatureCollection, type LotFeature, type LotsResponse } from "$lib/maps/lots-client.js";
  import {
    fetchZones,
    matchZonesToSignal,
    type ZoneFeatureCollection,
    type ZoneFeature,
  } from "$lib/maps/zones-client.js";
  import LotFichePanel from "$lib/components/maps/LotFichePanel.svelte";
  import MapLegend from "$lib/components/maps/MapLegend.svelte";
  import GrillesView from "$lib/components/scoring/GrillesView.svelte";
  import { fetchSignalDetail, type DesignationEventDetail } from "$lib/signals/signal-detail-client.js";
  import { fetchGraphSignalsByCity } from "$lib/signals/graph-signals-by-city-client.js";
  import { fetchGraphSignalDetail } from "$lib/signals/graph-signal-detail-client.js";
  import { loadLiveSignals } from "$lib/signals/signals-live.js";
  import { colorForScore } from "$lib/maps/score-color-scale.js";
  import {
    activeMarketMark,
    activePipelineMark,
    computeProspectCounters,
    fetchProspectMarksForZone,
    lotKey,
    prospectStatusShortLabel,
    type ProspectMark,
    type ProspectStatus,
  } from "$lib/prospect/prospect-marks-client.js";
  

  import { prioritizedCities } from "@radar/sources/municipalities";
  import type { SignalT } from "@radar/domain";

  // ── Onglets de la vue Évaluation ───────────────────────────────────────────
  // La vue Évaluation regroupe désormais deux onglets :
  //   "lots"    : drilldown Lots & Zonage (carte cadastrale + changements de zonage)
  //   "grilles" : modèle de score (grilles de tri /10 et d'opportunité /100),
  //               anciennement une vue top-level autonome, intégrée ici (WP4).
  // Le deep-link legacy `#/grilles` route ici avec l'onglet "grilles" actif
  // (App.svelte passe initialTab="grilles").
  export let initialTab: "lots" | "grilles" = "lots";
  let activeTab: "lots" | "grilles" = initialTab;

  const EVAL_TABS: { id: "lots" | "grilles"; label: string }[] = [
    { id: "lots", label: "Lots & Zonage" },
    { id: "grilles", label: "Grilles de score" },
  ];

  // ── Villes avec source lots et/ou zonage ──────────────────────────────────
  // source: "steve" = données carte Steve (CS-L6)
  // source: "mrnf"  = cadastre allégé MRNF (donnees-quebec)
  const EVAL_CITIES: Array<{ slug: string; name: string; mrc?: string; source?: "steve" | "mrnf" }> = [
    // Villes Steve (Roussillon — CS-L6)
    { slug: "delson", name: "Delson", mrc: "Roussillon", source: "steve" },
    { slug: "sainte-catherine", name: "Sainte-Catherine", mrc: "Roussillon", source: "steve" },
    { slug: "saint-constant", name: "Saint-Constant", mrc: "Roussillon", source: "steve" },
    { slug: "candiac", name: "Candiac", mrc: "Roussillon", source: "steve" },
    // Villes MRNF
    { slug: "salaberry-de-valleyfield", name: "Salaberry-de-Valleyfield", mrc: "Beauharnois-Salaberry", source: "mrnf" },
    { slug: "beauharnois", name: "Beauharnois", mrc: "Beauharnois-Salaberry", source: "mrnf" },
    { slug: "saint-damase", name: "Saint-Damase", mrc: "Les Maskoutains", source: "mrnf" },
    // Villes avec zonage géo canonique per-slug servi (geo #92 Lot A) + lots — démo join signal→zone
    { slug: "rosemere", name: "Rosemère", mrc: "Thérèse-De Blainville", source: "mrnf" },
    { slug: "westmount", name: "Westmount", mrc: "Montréal", source: "mrnf" },
    { slug: "hampstead", name: "Hampstead", mrc: "Montréal", source: "mrnf" },
    { slug: "cote-saint-luc", name: "Côte-Saint-Luc", mrc: "Montréal", source: "mrnf" },
    { slug: "dorval", name: "Dorval", mrc: "Montréal", source: "mrnf" },
    { slug: "longueuil", name: "Longueuil", mrc: "Longueuil", source: "mrnf" },
    { slug: "chambly", name: "Chambly", mrc: "La Vallée-du-Richelieu", source: "mrnf" },
  ];

  // ── Switch source ──────────────────────────────────────────────────────────
  // "steve" : villes carte Steve (CS-L6)
  // "mrnf"  : villes MRNF (donnees-quebec)
  let sourceFilter: "steve" | "mrnf" = "steve";

  const PROSPECT_FILTERS: Array<{ value: ProspectStatus | "all" | "unmarked"; label: string }> = [
    { value: "all", label: "Tous" },
    { value: "favori", label: "Favoris" },
    { value: "ecarte", label: "Non retenus" },
    { value: "sollicite", label: "Sollicités" },
    { value: "lettre_envoyee", label: "Lettres" },
    { value: "en_vente", label: "En vente" },
    { value: "unmarked", label: "Sans marque" },
  ];

  $: filteredCities = EVAL_CITIES.filter((c) => c.source === sourceFilter);

  // ── Données signaux (section grille — signaux réels depuis l'API) ─────────
  interface CitySignalEntry {
    slug: string;
    name: string;
    mrc?: string;
    signals: SignalT[];
  }

  let cityEntries: CitySignalEntry[] = [];
  let signalsLoading = true;

  // Chargement des signaux réels au montage (pipeline graph_nodes, ~197 villes)
  async function loadSignalEntries(): Promise<void> {
    try {
      const allSignals = await loadLiveSignals({
        fetchGraphSignalsByCity,
        fetchGraphSignalDetail,
      });
      // Grouper par ville depuis l'index des villes prioritisées
      // L'id des signaux graph_nodes est "gn-{citySlug}-{index}"
      const allCities = prioritizedCities();
      const bySlug = new Map<string, SignalT[]>();
      for (const signal of allSignals) {
        const match = signal.id.match(/^gn-(.+)-\d+$/);
        if (match) {
          const slug = match[1];
          if (!bySlug.has(slug)) bySlug.set(slug, []);
          bySlug.get(slug)!.push(signal);
        }
      }
      const entries: CitySignalEntry[] = [];
      for (const [slug, sigs] of bySlug.entries()) {
        const city = allCities.find((c) => c.slug === slug);
        if (city) {
          entries.push({ slug, name: city.name, mrc: city.mrc ?? undefined, signals: sigs });
        }
      }
      cityEntries = entries;
    } catch {
      // En cas d'erreur, on laisse cityEntries vide (état honnête)
    } finally {
      signalsLoading = false;
    }
  }

  // ── State drilldown lots ───────────────────────────────────────────────────
  let selectedEvalCity: (typeof EVAL_CITIES)[0] | null = null;
  let lotsLoading = false;
  let lotsError: string | null = null;
  let lotsFC: LotFeatureCollection = { type: "FeatureCollection", features: [] };
  let lotsResponse: LotsResponse | null = null;
  let hoveredLot: string | null = null;
  let selectedLot: LotFeature | null = null;
  let prospectMarksLoading = false;
  let prospectMarksError: string | null = null;
  let prospectMarks: ProspectMark[] = [];
  let prospectFilter: ProspectStatus | "all" | "unmarked" = "all";

  // ── State changements de zonage ──────────────────────────────────────────
  let zonageLoading = false;
  let zonageError: string | null = null;
  let zonageEvents: DesignationEventDetail[] = [];

  // ── Couche ZONAGE géo (polygones de zone) — WP3 préparation ───────────────
  // Drapeau d'ACTIVATION de la couche de zonage géo (collection OGC
  // `qc-zonage-<slug>` servie par geo, cf. #92 part-2). Tant que la collection
  // n'est pas servie, `fetchZones` retourne 404 → FeatureCollection vide : la
  // couche est alors un no-op (aucun polygone rendu, aucun highlight). Passer
  // ce drapeau à `true` suffit à brancher le rendu dès que geo sert la 1re
  // collection — voir RENVOIE/“prêt à brancher”.
  // Typé `boolean` (pas le littéral `false`) pour que TS ne déclare pas le
  // chemin d'activation « code mort » : flipper la constante suffit à brancher.
  const ZONES_LAYER_ENABLED: boolean = true;
  let zonesFC: ZoneFeatureCollection = { type: "FeatureCollection", features: [] };

  // ── State signaux ─────────────────────────────────────────────────────────
  let selectedCity: CitySignalEntry | null = cityEntries[0] ?? null;
  let selectedSignal: SignalT | null =
    cityEntries[0]?.signals[0] ?? null;

  function selectCity(entry: CitySignalEntry): void {
    selectedCity = entry;
    selectedSignal = entry.signals[0] ?? null;
  }

  function selectSignal(signal: SignalT): void {
    selectedSignal = selectedSignal?.id === signal.id ? null : signal;
  }

  $: citySignals = selectedCity?.signals ?? [];

  function hasEvaluationData(signal: SignalT | null): boolean {
    return (
      selectedCity?.slug === PILOT_CITY_SLUG &&
      signal?.type === "residential-rezoning" &&
      !!signal.zone
    );
  }

  $: evalAvailable = hasEvaluationData(selectedSignal);

  // ── Mode carte-steve détecté depuis la réponse API ────────────────────────
  $: isCarteSteve = lotsResponse?.source === "carte-steve" || lotsResponse?.mode === "carte-steve";

  // ── Chargement des lots ────────────────────────────────────────────────────

  async function loadProspectMarks(citySlug: string): Promise<void> {
    prospectMarksLoading = true;
    prospectMarksError = null;
    prospectMarks = [];
    prospectFilter = "all";
    try {
      prospectMarks = await fetchProspectMarksForZone(citySlug);
    } catch (e) {
      prospectMarksError = e instanceof Error ? e.message : "Marques indisponibles";
    } finally {
      prospectMarksLoading = false;
    }
  }

  async function loadLots(citySlug: string): Promise<void> {
    lotsLoading = true;
    lotsError = null;
    lotsFC = { type: "FeatureCollection", features: [] };
    lotsResponse = null;
    selectedLot = null;
    hoveredLot = null;
    try {
      const res = await fetchLots(citySlug, { limit: 200 });
      lotsResponse = res;
      lotsFC = res.featureCollection;
      if (!res.ok) {
        lotsError = res.reason ?? "Source lots non disponible pour cette ville.";
      }
    } catch (e) {
      lotsError = e instanceof Error ? e.message : "Erreur de chargement des lots";
      lotsFC = { type: "FeatureCollection", features: [] };
    } finally {
      lotsLoading = false;
    }
  }

  // ── Chargement des changements de zonage ───────────────────────────────────

  async function loadZonage(citySlug: string): Promise<void> {
    zonageLoading = true;
    zonageError = null;
    zonageEvents = [];
    try {
      const res = await fetchSignalDetail(citySlug);
      zonageEvents = res.events;
    } catch (e) {
      // 404 / city not seeded → honest empty state, not an error banner
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("404") || msg.includes("ok=false")) {
        zonageEvents = [];
      } else {
        zonageError = msg;
      }
    } finally {
      zonageLoading = false;
    }
  }

  // ── Chargement de la couche zonage géo (gated) ────────────────────────────
  async function loadZones(citySlug: string): Promise<void> {
    zonesFC = { type: "FeatureCollection", features: [] };
    // Inerte tant que le drapeau d'activation est faux : aucun appel réseau.
    if (!ZONES_LAYER_ENABLED) return;
    try {
      const res = await fetchZones(citySlug, { limit: 500 });
      // 404 (collection pas encore servie) → ok=false → features:[] → no-op.
      zonesFC = res.featureCollection;
    } catch {
      // État honnête : on garde la couche vide en cas d'erreur réseau.
      zonesFC = { type: "FeatureCollection", features: [] };
    }
  }

  function selectEvalCity(city: (typeof EVAL_CITIES)[0]): void {
    selectedEvalCity = city;
    void loadLots(city.slug);
    void loadZonage(city.slug);
    void loadProspectMarks(city.slug);
    void loadZones(city.slug);
  }

  // ── Sélection automatique de la 1re ville lors du changement de filtre ────
  $: {
    const first = filteredCities[0];
    if (first && (!selectedEvalCity || !filteredCities.some((c) => c.slug === selectedEvalCity?.slug))) {
      selectEvalCity(first);
    }
  }

  onMount(() => {
    const first = filteredCities[0];
    if (first) {
      selectedEvalCity = first;
      void loadLots(first.slug);
      void loadZonage(first.slug);
      void loadProspectMarks(first.slug);
      void loadZones(first.slug);
    }
    void loadSignalEntries();
  });

  // ── Projection SVG des polygones GeoJSON ──────────────────────────────────
  // Même approche que SignauxMapView : équirectangulaire, SVG pur.
  const SVG_W = 640;
  const SVG_H = 400;

  interface SvgBbox {
    minLon: number;
    minLat: number;
    maxLon: number;
    maxLat: number;
  }

  function computeLotsBbox(features: LotFeature[]): SvgBbox {
    let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
    for (const f of features) {
      if (!f.geometry || f.geometry.type !== "Polygon") continue;
      const rings = f.geometry.coordinates as number[][][];
      for (const ring of rings) {
        for (const pt of ring) {
          const lon = pt[0];
          const lat = pt[1];
          if (lon < minLon) minLon = lon;
          if (lon > maxLon) maxLon = lon;
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
        }
      }
    }
    if (!isFinite(minLon)) {
      // Fallback : Montérégie approximative
      return { minLon: -74.2, minLat: 45.2, maxLon: -73.4, maxLat: 45.6 };
    }
    const padLon = (maxLon - minLon) * 0.08 + 0.001;
    const padLat = (maxLat - minLat) * 0.08 + 0.001;
    return {
      minLon: minLon - padLon,
      minLat: minLat - padLat,
      maxLon: maxLon + padLon,
      maxLat: maxLat + padLat,
    };
  }

  function projX(lon: number, bbox: SvgBbox): number {
    return ((lon - bbox.minLon) / (bbox.maxLon - bbox.minLon)) * SVG_W;
  }

  function projY(lat: number, bbox: SvgBbox): number {
    return ((bbox.maxLat - lat) / (bbox.maxLat - bbox.minLat)) * SVG_H;
  }

  function ringToPoints(ring: number[][], bbox: SvgBbox): string {
    return ring
      .map((pt) => `${projX(pt[0], bbox).toFixed(2)},${projY(pt[1], bbox).toFixed(2)}`)
      .join(" ");
  }

  /**
   * Étend une bbox lots avec l'emprise des polygones de zone, pour que la
   * couche zonage géo soit projetée dans le même repère que les lots. No-op
   * concret tant que la couche zonage est inerte (aucune zone à folder).
   */
  function extendBboxWithZones(base: SvgBbox, zones: ZoneFeature[]): SvgBbox {
    let { minLon, minLat, maxLon, maxLat } = base;
    for (const z of zones) {
      if (!z.geometry || z.geometry.type !== "Polygon") continue;
      const rings = z.geometry.coordinates as number[][][];
      for (const ring of rings) {
        for (const pt of ring) {
          if (pt[0] < minLon) minLon = pt[0];
          if (pt[0] > maxLon) maxLon = pt[0];
          if (pt[1] < minLat) minLat = pt[1];
          if (pt[1] > maxLat) maxLat = pt[1];
        }
      }
    }
    return { minLon, minLat, maxLon, maxLat };
  }

  $: lotsBbox = computeLotsBbox(lotsFC.features);
  $: polygonFeatures = lotsFC.features.filter(
    (f) => f.geometry && f.geometry.type === "Polygon" && !f.properties.isRue,
  );
  let prospectMarksByLot = new Map<string, ProspectMark[]>();
  $: {
    prospectMarksByLot = new Map<string, ProspectMark[]>();
    for (const mark of prospectMarks) {
      const key = lotKey(mark.noLot, mark.citySlug);
      prospectMarksByLot.set(key, [...(prospectMarksByLot.get(key) ?? []), mark]);
    }
  }
  $: prospectCounters = computeProspectCounters(
    polygonFeatures.map((feature) => ({
      noLot: feature.properties.noLot,
      citySlug: feature.properties.citySlug ?? selectedEvalCity?.slug ?? "",
    })),
    prospectMarks,
  );
  $: filteredPolygonFeatures = polygonFeatures.filter((feature) => {
    if (prospectFilter === "all") return true;
    const key = lotKey(feature.properties.noLot, feature.properties.citySlug ?? selectedEvalCity?.slug ?? "");
    const marks = prospectMarks.filter((mark) => lotKey(mark.noLot, mark.citySlug) === key);
    const pipeline = activePipelineMark(marks);
    const market = activeMarketMark(marks);
    if (prospectFilter === "unmarked") return !pipeline && !market;
    return pipeline?.statut === prospectFilter || market?.statut === prospectFilter;
  });

  function prospectCounterFor(filter: ProspectStatus | "all" | "unmarked"): number {
    if (filter === "all") return prospectCounters.all;
    if (filter === "unmarked") return prospectCounters.unmarked;
    return prospectCounters[filter];
  }

  // ── Couche zonage géo : polygones + appariement au signal sélectionné ─────
  // Inerte tant que ZONES_LAYER_ENABLED est faux ou que la collection 404.
  $: zonePolygonFeatures = ZONES_LAYER_ENABLED
    ? zonesFC.features.filter((f) => f.geometry && f.geometry.type === "Polygon")
    : [];
  $: hasZoneLayer = zonePolygonFeatures.length > 0;
  // Codes de zone cités par le signal sélectionné (un SignalT porte `zone`).
  $: selectedSignalZoneCodes = selectedSignal?.zone ? [selectedSignal.zone] : [];
  // Zones de la couche géo qui matchent le signal sélectionné (join pur, WP3).
  $: matchedZoneCodes = new Set(
    matchZonesToSignal(selectedSignalZoneCodes, zonePolygonFeatures).map(
      (z) => z.properties.code,
    ),
  );
  // bbox commune lots+zones (identique à lotsBbox quand la couche est inerte).
  $: mapBbox = hasZoneLayer
    ? extendBboxWithZones(lotsBbox, zonePolygonFeatures)
    : lotsBbox;

  // ── Indicateurs réactifs ──────────────────────────────────────────────────
  $: isLoadingEval = lotsLoading || zonageLoading;
  $: hasZonage = zonageEvents.length > 0;
  $: hasLots = polygonFeatures.length > 0;
  $: scoredLotCount = polygonFeatures.filter((f) => (f.properties.potentialScore ?? 0) > 0).length;
  $: highPotentialLotCount = polygonFeatures.filter((f) => (f.properties.potentialScore ?? 0) >= 7).length;
  $: fallbackScoreCount = polygonFeatures.filter((f) => f.properties.potentialScoreStatus === "fallback").length;
  $: unavailableScoreCount = polygonFeatures.filter((f) => f.properties.potentialScoreStatus === "unavailable").length;

  function lotScore(feature: LotFeature): number {
    const score = feature.properties.potentialScore;
    return typeof score === "number" && Number.isFinite(score) ? score : 0;
  }

  function lotFill(feature: LotFeature): string {
    return colorForScore(lotScore(feature), null);
  }

  function lotOpacity(feature: LotFeature, selected: boolean, hovered: boolean): string {
    if (selected) return "0.78";
    if (hovered) return "0.75";
    return lotScore(feature) > 0 ? "0.62" : "0.34";
  }
</script>

<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
  <!-- ── Onglets de la vue Évaluation : Lots & Zonage | Grilles de score ──── -->
  <div class="shrink-0 border-b border-slate-200 bg-white px-4">
    <div class="flex gap-1" role="tablist" aria-label="Vues d'évaluation">
      {#each EVAL_TABS as tab (tab.id)}
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === tab.id}
          class={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === tab.id
              ? "border-teal-600 text-teal-700"
              : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
          }`}
          on:click={() => { activeTab = tab.id; }}
        >
          {tab.label}
        </button>
      {/each}
    </div>
  </div>

  {#if activeTab === "grilles"}
    <!-- Onglet Grilles : modèle de score réutilisé tel quel (composant autonome) -->
    <GrillesView />
  {:else}
    <ViewLayout controlsWidth="w-80">
      <!-- ── Left: sélecteur évaluation (lots + zonage) + signaux ────────────── -->
  <svelte:fragment slot="controls">
    <!-- Titre -->
    <div class="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
      <BarChart3 class="h-4 w-4 text-teal-600" aria-hidden="true" />
      <h1 class="text-sm font-bold text-slate-900">Évaluation : Lots & Zonage</h1>
    </div>

    <!-- Switch source Steve ↔ MRNF -->
    <div class="border-b border-slate-200 px-4 py-3">
      <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Source de données</p>
      <div class="flex gap-2">
        <button
          type="button"
          class={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
            sourceFilter === "steve"
              ? "border-orange-400 bg-orange-50 text-orange-800"
              : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
          }`}
          on:click={() => { sourceFilter = "steve"; }}
          aria-pressed={sourceFilter === "steve"}
        >
          Steve (rôle 2022 + zonage + TOD)
        </button>
        <button
          type="button"
          class={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
            sourceFilter === "mrnf"
              ? "border-teal-400 bg-teal-50 text-teal-800"
              : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
          }`}
          on:click={() => { sourceFilter = "mrnf"; }}
          aria-pressed={sourceFilter === "mrnf"}
        >
          Nos signaux (MRNF)
        </button>
      </div>
    </div>

    <!-- Section lots + zonage -->
    <div class="border-b border-slate-100 px-4 py-2 flex items-center justify-between">
      <span class="text-xs font-semibold uppercase tracking-wide text-slate-400 flex items-center gap-1">
        <Layers class="h-3 w-3" aria-hidden="true" />
        Villes avec lots ET/OU zonage
      </span>
      {#if selectedEvalCity}
        <button
          type="button"
          aria-label="Actualiser"
          class="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          on:click={() => { if (selectedEvalCity) selectEvalCity(selectedEvalCity); }}
          disabled={isLoadingEval}
        >
          <RefreshCw class={`h-3.5 w-3.5 ${isLoadingEval ? "animate-spin" : ""}`} aria-hidden="true" />
        </button>
      {/if}
    </div>

    <!-- Sélecteur de ville (lots + zonage) -->
    <div class="divide-y divide-slate-100 border-b border-slate-200">
      {#each filteredCities as city (city.slug)}
        {@const isSelected = selectedEvalCity?.slug === city.slug}
        <button
          type="button"
          class={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
            isSelected ? "bg-teal-50 border-l-2 border-teal-500" : "hover:bg-slate-50"
          }`}
          on:click={() => selectEvalCity(city)}
        >
          <MapPin
            class={`h-3.5 w-3.5 shrink-0 ${isSelected ? "text-teal-600" : "text-slate-300"}`}
            aria-hidden="true"
          />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-medium text-slate-900">
              {city.name}
            </span>
            {#if city.mrc}
              <span class="text-xs text-slate-400">{city.mrc}</span>
            {/if}
            {#if isSelected && !isLoadingEval}
              <span class="block text-xs text-teal-600 mt-0.5" data-testid="city-summary">
                {#if hasZonage || hasLots}
                  {#if hasZonage}
                    {zonageEvents.length} changement{zonageEvents.length !== 1 ? "s" : ""} de zonage
                  {/if}
                  {#if hasZonage && hasLots}
                    &nbsp;·&nbsp;
                  {/if}
                  {#if hasLots}
                    {polygonFeatures.length} lot{polygonFeatures.length !== 1 ? "s" : ""} chargé{polygonFeatures.length !== 1 ? "s" : ""}
                  {/if}
                {/if}
              </span>
            {/if}
          </span>
          {#if isSelected}
            {#if isLoadingEval}
              <span class="text-xs text-slate-400">…</span>
            {:else if lotsError && zonageError}
              <AlertCircle class="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
            {:else}
              <div class="flex flex-col items-end gap-0.5">
                {#if hasZonage}
                  <Badge tone="warning" class="text-xs shrink-0">
                    {zonageEvents.length}&nbsp;zon.
                  </Badge>
                {/if}
                {#if hasLots}
                  <Badge tone="success" class="text-xs shrink-0">
                    {polygonFeatures.length}&nbsp;lots
                  </Badge>
                {/if}
              </div>
            {/if}
          {:else}
            <ChevronRight class="h-4 w-4 shrink-0 text-slate-300" aria-hidden="true" />
          {/if}
        </button>
      {/each}
    </div>

    <!-- Section signaux -->
    <div class="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400 border-b border-slate-100">
      Signaux réels · Villes suivies
    </div>

    {#if signalsLoading}
      <div class="p-4 text-xs text-slate-400">Chargement des signaux…</div>
    {:else if cityEntries.length === 0}
      <div class="p-4">
        <Alert
          tone="info"
          title="Aucune ville avec signaux."
          message="Les signaux sont collectés automatiquement lors du recueil de documents municipaux."
        />
      </div>
    {:else}
      <div class="divide-y divide-slate-100">
        {#each cityEntries as entry (entry.slug)}
          {@const isSelected = selectedCity?.slug === entry.slug}
          <button
            type="button"
            class={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
              isSelected ? "bg-teal-50 border-l-2 border-teal-500" : "hover:bg-slate-50"
            }`}
            on:click={() => selectCity(entry)}
          >
            <MapPin
              class={`h-3.5 w-3.5 shrink-0 ${isSelected ? "text-teal-600" : "text-slate-300"}`}
              aria-hidden="true"
            />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium text-slate-900">
                {entry.name}
              </span>
              <span class="text-xs text-slate-400">
                {entry.signals.filter((s) => s.zone).length} zone{entry.signals.filter((s) => s.zone).length !== 1 ? "s" : ""}
              </span>
            </span>
            <ChevronRight
              class={`h-4 w-4 shrink-0 ${isSelected ? "text-teal-500" : "text-slate-300"}`}
              aria-hidden="true"
            />
          </button>
        {/each}
      </div>

      {#if selectedCity}
        <div class="border-t border-slate-200 pt-2">
          <p class="px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Zones / Signaux
          </p>
          <ul class="divide-y divide-slate-100">
            {#each citySignals as signal (signal.id)}
              {@const isSelected = selectedSignal?.id === signal.id}
              <li>
                <button
                  type="button"
                  class={`flex w-full items-center gap-3 px-4 py-2 text-left transition-colors ${
                    isSelected ? "bg-teal-50" : "hover:bg-slate-50"
                  }`}
                  on:click={() => selectSignal(signal)}
                >
                  <span
                    class={`h-2 w-2 shrink-0 rounded-full ${
                      signal.confidence === "high" ? "bg-teal-500"
                      : signal.confidence === "medium" ? "bg-amber-400"
                      : "bg-red-400"
                    }`}
                    aria-hidden="true"
                  ></span>
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-xs font-medium text-slate-800">
                      {signal.zone ?? SIGNAL_TYPE_LABEL[signal.type] ?? signal.type}
                    </span>
                    {#if signal.zone}
                      <span class="text-xs text-slate-400">{SIGNAL_TYPE_LABEL[signal.type] ?? signal.type}</span>
                    {/if}
                  </span>
                </button>
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    {/if}
  </svelte:fragment>

  <!-- ── Main: panneau côte à côte zonage + lots + grille signal ───────────── -->
  <div class="flex h-full flex-col bg-slate-50 p-4 gap-4 overflow-y-auto">

    <!-- ─── Panneau côte à côte : Zonage + Lots ───────────────────────────── -->
    {#if selectedEvalCity}
      <div class="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <!-- En-tête ville avec résumé -->
        <div class="border-b border-slate-100 px-4 py-3 flex items-center justify-between bg-teal-50">
          <div>
            <h2 class="text-sm font-bold text-teal-900">
              {selectedEvalCity.name}
            </h2>
            {#if selectedEvalCity.mrc}
              <p class="text-xs text-slate-500">MRC : {selectedEvalCity.mrc}</p>
            {/if}
          </div>
          <!-- Résumé compteurs -->
          {#if isLoadingEval}
            <RefreshCw class="h-4 w-4 animate-spin text-teal-500" aria-hidden="true" />
          {:else}
            <div class="flex items-center gap-2 flex-wrap justify-end" data-testid="eval-summary">
              {#if hasZonage}
                <Badge tone="warning" class="text-xs">
                  {zonageEvents.length}&nbsp;changement{zonageEvents.length !== 1 ? "s" : ""}&nbsp;de&nbsp;zonage
                </Badge>
              {:else if !zonageError}
                <span class="text-xs text-slate-400">Aucun zonage</span>
              {/if}
              {#if hasLots}
                <Badge tone="success" class="text-xs">
                  {polygonFeatures.length}&nbsp;lot{polygonFeatures.length !== 1 ? "s" : ""}&nbsp;chargé{polygonFeatures.length !== 1 ? "s" : ""}
                </Badge>
                <Badge tone="info" class="text-xs">
                  {scoredLotCount}&nbsp;scoré{scoredLotCount !== 1 ? "s" : ""}
                </Badge>
                <Badge tone="warning" class="text-xs">
                  {highPotentialLotCount}&nbsp;prioritaire{highPotentialLotCount !== 1 ? "s" : ""}
                </Badge>
              {:else if !lotsError}
                <span class="text-xs text-slate-400">Aucun lot</span>
              {/if}
              {#if isCarteSteve}
                <Badge tone="neutral" class="text-xs">Steve</Badge>
              {/if}
            </div>
          {/if}
        </div>

        <!-- Corps : côte à côte (flex-col sur petit écran, flex-row sur grand) -->
        <div class="flex flex-col lg:flex-row divide-y lg:divide-y-0 lg:divide-x divide-slate-100">

          <!-- ── Colonne gauche : Changements de zonage ───────────────────── -->
          <div class="flex-1 min-w-0 p-4" data-testid="zonage-panel">
            <div class="flex items-center gap-2 mb-3">
              <FileText class="h-4 w-4 text-amber-500 shrink-0" aria-hidden="true" />
              <span class="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Changements de zonage
              </span>
            </div>

            {#if zonageLoading}
              <div class="flex items-center gap-2 py-4 text-xs text-slate-400">
                <RefreshCw class="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Chargement…
              </div>
            {:else if zonageError}
              <Alert
                tone="warning"
                title="Données de zonage non disponibles"
                message={zonageError}
              />
            {:else if !hasZonage}
              <div class="rounded-lg border border-slate-100 bg-slate-50 p-3 text-center" data-testid="zonage-empty">
                <p class="text-xs text-slate-400">Aucun changement de zonage disponible.</p>
                <p class="mt-0.5 text-xs text-slate-300">
                  Les données proviennent des DesignationEvent de l'état projet ontologie.
                </p>
              </div>
            {:else}
              <!-- Note honnête sur la géométrie de zone -->
              <div class="mb-3 flex items-start gap-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <Info class="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-500" aria-hidden="true" />
                <p>
                  Lien zonage → lots : la géométrie exacte de la zone n'est pas disponible.
                  Les lots de la ville entière sont affichés avec la/les zone(s) du signal en libellé.
                </p>
              </div>

              <ul class="space-y-2" aria-label="Changements de zonage" data-testid="zonage-list">
                {#each zonageEvents as event, i (i)}
                  <li class="rounded-lg border border-teal-100 bg-teal-50 px-3 py-2.5">
                    <p class="text-xs font-semibold text-teal-800 leading-snug">
                      {event.label}
                    </p>
                    <div class="mt-1.5 flex flex-wrap gap-1">
                      {#each event.reglementNumbers as num (num)}
                        <Badge tone="info" class="text-xs font-mono">
                          Règl. {num}
                        </Badge>
                      {/each}
                      {#each event.zoneRefs as zone (zone)}
                        <Badge tone="warning" class="text-xs font-mono">
                          Zone {zone}
                        </Badge>
                      {/each}
                    </div>
                    {#if event.dateObserved}
                      <p class="mt-1 text-xs text-slate-400">
                        Observé : {new Date(event.dateObserved).toLocaleDateString("fr-CA")}
                      </p>
                    {/if}
                  </li>
                {/each}
              </ul>
            {/if}
          </div>

          <!-- ── Colonne droite : Lots cadastraux ─────────────────────────── -->
          <div class="flex-1 min-w-0" data-testid="lots-panel">
            <div class="px-4 pt-4 pb-2 flex items-center justify-between">
              <div class="flex items-center gap-2">
                <Layers class="h-4 w-4 text-teal-500 shrink-0" aria-hidden="true" />
                <span class="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {isCarteSteve ? "Lots cadastraux Steve" : "Lots cadastraux MRNF"}
                </span>
              </div>
              {#if !lotsLoading && !lotsError && hasLots}
                <span class="text-xs text-slate-400">
                  {filteredPolygonFeatures.length}/{polygonFeatures.length} lot{polygonFeatures.length !== 1 ? "s" : ""} · {isCarteSteve ? "Steve" : "CC-BY"}
                </span>
              {/if}
            </div>

            {#if !lotsLoading && !lotsError && hasLots}
              <div class="border-t border-slate-100 px-4 py-2" data-testid="prospect-mark-filters">
                <div class="mb-1 flex items-center justify-between gap-2">
                  <p class="text-xs font-semibold uppercase tracking-wide text-slate-400">Filtres par marque</p>
                  {#if prospectMarksLoading}
                    <span class="text-xs text-slate-400">chargement…</span>
                  {:else if prospectMarksError}
                    <span class="text-xs text-amber-600" title={prospectMarksError}>marques indisponibles</span>
                  {/if}
                </div>
                <div class="flex flex-wrap gap-1.5">
                  {#each PROSPECT_FILTERS as filter (filter.value)}
                    <button
                      type="button"
                      class={`rounded-full border px-2 py-1 text-xs transition-colors ${
                        prospectFilter === filter.value
                          ? "border-teal-300 bg-teal-50 font-semibold text-teal-800"
                          : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
                      }`}
                      on:click={() => { prospectFilter = filter.value; }}
                      aria-pressed={prospectFilter === filter.value}
                    >
                      {filter.label} <span class="tabular-nums text-slate-400">{prospectCounterFor(filter.value)}</span>
                    </button>
                  {/each}
                </div>
              </div>
            {/if}

            {#if lotsLoading}
              <div class="flex items-center justify-center p-6 text-sm text-slate-400">
                <RefreshCw class="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                Chargement des lots…
              </div>

            {:else if lotsError}
              <div class="px-4 pb-4">
                <Alert
                  tone="warning"
                  title="Données de lots non disponibles"
                  message={lotsError}
                />
              </div>

            {:else if !hasLots}
              <div class="px-4 pb-4" data-testid="lots-empty">
                <Alert
                  tone="info"
                  title="Aucun lot disponible pour cette ville."
                  message={isCarteSteve
                    ? "La source Steve n'a retourné aucun lot pour cette ville. Vérifiez que les fixtures CS-L6 sont chargées."
                    : "La source MRNF n'a retourné aucun lot pour cette ville dans la zone couverte. Essayez une autre ville."}
                />
              </div>

            {:else}
              <!-- Carte SVG des polygones lots -->
              <svg
                viewBox={`0 0 ${SVG_W} ${SVG_H}`}
                width="100%"
                aria-label={`Carte des lots cadastraux de ${selectedEvalCity?.name ?? ""}`}
                role="img"
                class="block"
                style="max-height: 340px; cursor: default;"
              >
                <rect width={SVG_W} height={SVG_H} class="fill-blue-50" rx="2" />

                <!-- Couche zonage géo (WP3) — rendue SOUS les lots, inerte tant
                     que ZONES_LAYER_ENABLED est faux ou que la collection 404.
                     Les zones matchées au signal sélectionné sont mises en
                     évidence (remplissage ambré). -->
                {#if hasZoneLayer}
                  {#each zonePolygonFeatures as zone (zone.properties.code)}
                    {@const zRings = zone.geometry?.coordinates as number[][][] | undefined}
                    {@const isMatched = matchedZoneCodes.has(zone.properties.code)}
                    {#if zRings && zRings.length > 0}
                      <polygon
                        points={ringToPoints(zRings[0], mapBbox)}
                        fill={isMatched ? "#f59e0b" : "none"}
                        fill-opacity={isMatched ? "0.25" : "0"}
                        stroke={isMatched ? "#d97706" : "#94a3b8"}
                        stroke-width={isMatched ? "1.6" : "0.6"}
                        stroke-dasharray={isMatched ? "none" : "3 2"}
                      >
                        <title>Zone {zone.properties.code}{isMatched ? " (citée par le signal)" : ""}{zone.properties.grillePdfUrl ? " — grille PDF disponible" : ""}</title>
                      </polygon>
                    {/if}
                  {/each}
                {/if}

                {#each filteredPolygonFeatures as feature (feature.properties.noLot)}
                  {@const rings = feature.geometry?.coordinates as number[][][] | undefined}
                  {@const isHovered = hoveredLot === feature.properties.noLot}
                  {@const isLotSelected = selectedLot?.properties.noLot === feature.properties.noLot}
                  {@const lotMarks = prospectMarksByLot.get(lotKey(feature.properties.noLot, feature.properties.citySlug ?? selectedEvalCity?.slug ?? "")) ?? []}
                  {@const lotPipelineMark = activePipelineMark(lotMarks)}
                  {@const lotMarketMark = activeMarketMark(lotMarks)}
                  {@const scoreFill = lotFill(feature)}
                  {#if rings && rings.length > 0}
                    <!-- svelte-ignore a11y-click-events-have-key-events -->
                    <!-- svelte-ignore a11y-no-static-element-interactions -->
                    <g
                      class="cursor-pointer"
                      on:click={() => {
                        selectedLot = isLotSelected ? null : feature;
                      }}
                      on:mouseenter={() => { hoveredLot = feature.properties.noLot; }}
                      on:mouseleave={() => { hoveredLot = null; }}
                      role="button"
                      aria-label="Lot {feature.properties.noLot}"
                      tabindex="0"
                    >
                      <polygon
                        points={ringToPoints(rings[0], mapBbox)}
                        fill={isLotSelected ? "#0d9488" : scoreFill}
                        stroke={isLotSelected ? "#0d9488" : scoreFill}
                        stroke-width={isLotSelected ? "1.5" : "0.8"}
                        fill-opacity={lotOpacity(feature, isLotSelected, isHovered)}
                      />
                      {#if (isHovered || isLotSelected) && rings[0].length > 0}
                        {@const cx = rings[0].reduce((s, p) => s + projX(p[0], mapBbox), 0) / rings[0].length}
                        {@const cy = rings[0].reduce((s, p) => s + projY(p[1], mapBbox), 0) / rings[0].length}
                        <text
                          x={cx}
                          y={cy}
                          text-anchor="middle"
                          dominant-baseline="middle"
                          style="font-size: 9px; font-weight: 600; pointer-events: none;"
                          fill={isLotSelected ? "white" : "#0d9488"}
                        >
                          {feature.properties.noLot}{lotPipelineMark ? ` · ${prospectStatusShortLabel(lotPipelineMark.statut)}` : lotMarketMark ? ` · ${prospectStatusShortLabel(lotMarketMark.statut)}` : ""}
                        </text>
                      {/if}
                    </g>
                  {/if}
                {/each}
              </svg>

              <MapLegend
                fallbackCount={fallbackScoreCount}
                unavailableCount={unavailableScoreCount}
              />

              <!-- Fiche lot complète — CS-L2 -->
              {#if selectedLot}
                <div class="border-t border-teal-100">
                  <LotFichePanel
                    lot={selectedLot}
                    cityName={selectedEvalCity?.name ?? ""}
                    allowMarquage={true}
                    mode={isCarteSteve ? "simulation" : "real"}
                    onClose={() => { selectedLot = null; }}
                  />
                </div>
              {/if}
            {/if}
          </div>

        </div>
      </div>
    {/if}

    <!-- ─── Section grille d'évaluation signal ─────────────────────────────── -->
    {#if !selectedCity || !selectedSignal}
      <div class="flex items-center justify-center rounded-xl border border-slate-100 bg-white p-6 text-center">
        <div>
          <BarChart3 class="mx-auto mb-3 h-8 w-8 text-slate-300" aria-hidden="true" />
          <p class="text-sm text-slate-400">Sélectionnez un signal pour évaluer ses lots.</p>
        </div>
      </div>
    {:else}
      <!-- En-tête signal -->
      <div class="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 class="text-base font-semibold text-slate-900">
              {selectedCity.name}
              {#if selectedSignal.zone}
                <span class="ml-2 font-mono text-sm text-teal-700">Zone {selectedSignal.zone}</span>
              {/if}
            </h2>
            {#if selectedCity.mrc}
              <p class="text-xs text-slate-400 mt-0.5">MRC : {selectedCity.mrc}</p>
            {/if}
          </div>
          <div class="flex items-center gap-2 flex-wrap">
            <Badge tone={CONFIDENCE_TONE[selectedSignal.confidence] ?? "neutral"} class="text-xs">
              Confiance : {selectedSignal.confidence === "high" ? "Haute" : selectedSignal.confidence === "medium" ? "Moyenne" : "Faible"}
            </Badge>
            {#if selectedSignal.bylaw}
              <Badge tone="neutral" class="text-xs">Règl. {selectedSignal.bylaw}</Badge>
            {/if}
          </div>
        </div>
        <div class="mt-3 text-xs text-slate-500">
          <span class="font-medium text-slate-700">{SIGNAL_TYPE_LABEL[selectedSignal.type] ?? selectedSignal.type}</span>
          {#if selectedSignal.sourceRefs.length > 0}
            <span class="ml-2 text-slate-400">· Sources : {selectedSignal.sourceRefs.join(", ")}</span>
          {/if}
        </div>
      </div>

      {#if evalAvailable}
        <!-- Grille d'évaluation (5 axes) -->
        <div class="rounded-xl border border-teal-200 bg-white shadow-sm overflow-hidden">
          <div class="border-b border-teal-100 px-4 py-3 bg-teal-50 flex items-center gap-2">
            <BarChart3 class="h-4 w-4 text-teal-600" aria-hidden="true" />
            <span class="text-sm font-semibold text-teal-900">Grille d'évaluation /100</span>
            <Badge tone="warning" class="ml-auto text-xs">Données partielles</Badge>
          </div>

          <div class="p-4 space-y-3">
            <div class="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <Info class="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600" aria-hidden="true" />
              <p>
                Le signal de zonage est confirmé (données réelles). L'évaluation de lot complète
                (CU, FAR, prix au m², accès réseaux) requiert l'extraction du rôle d'évaluation
                MAMH ; cette étape n'est pas encore réalisée pour cette zone.
              </p>
            </div>

            <table class="w-full text-xs">
              <thead>
                <tr class="border-b border-slate-100">
                  <th class="py-1.5 text-left font-semibold text-slate-500 uppercase tracking-wide">Axe</th>
                  <th class="py-1.5 text-center font-semibold text-slate-500 uppercase tracking-wide w-20">Score</th>
                  <th class="py-1.5 text-left font-semibold text-slate-500 uppercase tracking-wide">Statut</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-50">
                {#each [
                  { axis: "Potentiel de densification", available: true,  note: "Rezonage résidentiel confirmé (bylaw {bylaw})" },
                  { axis: "Risque réglementaire",       available: true,  note: "Processus de consultation publique en cours" },
                  { axis: "Timing",                     available: false, note: "En attente de la date d'entrée en vigueur" },
                  { axis: "Faisabilité technique",      available: false, note: "Extraction rôle MAMH non réalisée" },
                  { axis: "Marché",                     available: false, note: "Données de transaction non collectées" },
                ] as row}
                  <tr class="py-2">
                    <td class="py-2 font-medium text-slate-700">{row.axis}</td>
                    <td class="py-2 text-center">
                      {#if row.available}
                        <span class="inline-flex h-6 w-6 items-center justify-center rounded-full bg-teal-100 text-xs font-bold text-teal-700">?</span>
                      {:else}
                        <span class="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs text-slate-400">N/A</span>
                      {/if}
                    </td>
                    <td class="py-2 text-slate-500">
                      {row.note.replace("{bylaw}", selectedSignal?.bylaw ?? "N/A")}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>

            <div class="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 flex items-center justify-between gap-3">
              <span class="text-sm font-semibold text-slate-700">Score global estimé</span>
              <div class="text-right">
                <p class="text-lg font-bold text-slate-400">N/A / 100</p>
                <p class="text-xs text-slate-400">Score incomplet (axes manquants)</p>
              </div>
            </div>
          </div>
        </div>

      {:else if selectedCity.slug !== PILOT_CITY_SLUG}
        <Alert
          tone="info"
          title="Données d'évaluation non disponibles pour cette ville."
          message="L'évaluation de lots est disponible uniquement pour la ville pilote (Salaberry-de-Valleyfield). Les autres villes sont dans le plan de ciblage mais n'ont pas encore été sourcées."
        />

      {:else}
        <div class="rounded-xl border border-slate-100 bg-white shadow-sm p-6">
          <div class="flex items-start gap-3">
            <Info class="h-5 w-5 shrink-0 mt-0.5 text-slate-400" aria-hidden="true" />
            <div>
              <p class="text-sm font-medium text-slate-700">
                Évaluation de lot non disponible pour ce signal.
              </p>
              <p class="mt-1 text-xs text-slate-500">
                L'évaluation de lot est disponible pour les signaux de rezonage résidentiel
                avec une zone identifiée (mode réel). Ce signal de type
                <span class="font-medium">{SIGNAL_TYPE_LABEL[selectedSignal.type] ?? selectedSignal.type}</span>
                ne répond pas à ces critères (rezonage résidentiel avec zone identifiée requis).
              </p>
            </div>
          </div>
        </div>
      {/if}
    {/if}
  </div>
    </ViewLayout>
  {/if}
</div>
