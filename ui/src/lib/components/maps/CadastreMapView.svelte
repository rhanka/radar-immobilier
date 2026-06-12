<script lang="ts">
  /**
   * CadastreMapView — Wrapper carto MapLibre GL MINCE, **provisoire en attente
   * du composant DS carto** (cf. docs/spec/requests/ds-enrichment-viz-carto.md).
   *
   * Le design-system `@sentropic/design-system-svelte` (v0.7.0) n'expose AUCUN
   * composant carte. En attendant son enrichissement, ce wrapper rend les couches
   * GeoJSON (lots / zones / TOD / boundary) d'une ville cadastrale via MapLibre,
   * et capitalise sur le DS pour TOUT le reste :
   *   - chrome UI (panneau stats, badges, alertes) = composants DS (Badge, Alert) ;
   *   - rampe de couleur du score = TOKENS DS via `score-color-scale.ts` (aucune
   *     palette inventée, aucun fichier de style maison).
   *
   * Échelle : le coloriage des lots est piloté par une EXPRESSION MapLibre
   * `interpolate` sur `potentialScore` — le moteur GPU interpole, ce qui rend
   * >200 lots (jusqu'à ~11k) là où l'ancien rendu SVG capait à 200.
   *
   * Anti-PII (Loi 25) : on n'affiche que `noLot` (NO_LOT cadastral public) ;
   * aucune adresse, aucun propriétaire.
   *
   * Score de potentiel par lot : dérivé placeholder LOCAL (cf.
   * `cadastre-geojson-source.ts deriveLotPotentialScore`).
   * TODO: brancher GET /api/.../score (score-de-potentiel-par-lot canonique).
   */
  import { onMount, onDestroy } from "svelte";
  import { Badge, Alert } from "@sentropic/design-system-svelte";
  import { Layers, MapPin, Star } from "@lucide/svelte";
  import {
    loadCadastreCity,
    type CadastreCityLayers,
    type LotLayerProps,
  } from "$lib/maps/cadastre-geojson-source.js";
  import {
    lotFillColorExpression,
    lotFillOpacityExpression,
    lotLineColorExpression,
    scoreLegend,
    ZONE_LABEL_MINZOOM,
    type LegendEntry,
  } from "$lib/maps/score-color-scale.js";

  /** Slug de la ville de référence à charger (mode:simulation). */
  export let citySlug: string;
  /** Couches déjà chargées (court-circuite le fetch) — pour tests/composition. */
  export let layers: CadastreCityLayers | null = null;
  /** Fixture brute optionnelle passée au loader (offline). */
  export let raw: unknown = undefined;

  let container: HTMLDivElement;
  let map: unknown = null; // maplibregl.Map — typé large pour éviter la dépendance de type au build
  let loadError: string | null = null;
  let loading = true;
  let resolved: CadastreCityLayers | null = layers;
  let legend: LegendEntry[] = [];
  let selectedLot: LotLayerProps | null = null;

  const LOT_FILL = "radar-lots-fill";
  const LOT_LINE = "radar-lots-line";
  const ZONE_LINE = "radar-zones-line";
  const ZONE_LABEL = "radar-zones-label";
  const TOD_FILL = "radar-tod-fill";

  async function ensureLayers(): Promise<CadastreCityLayers> {
    if (resolved) return resolved;
    resolved = await loadCadastreCity(citySlug, {
      raw: raw as never,
    });
    return resolved;
  }

  async function initMap(): Promise<void> {
    loading = true;
    loadError = null;
    try {
      const data = await ensureLayers();
      // Import dynamique : MapLibre n'est chargé qu'au montage côté navigateur
      // (jamais en SSR / test jsdom sans WebGL).
      const maplibre = (await import("maplibre-gl")).default;
      legend = scoreLegend(container);

      const m = new maplibre.Map({
        container,
        style: {
          version: 8,
          sources: {},
          layers: [
            {
              id: "bg",
              type: "background",
              paint: { "background-color": readSurface() },
            },
          ],
          glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
        },
        bounds: data.bounds,
        fitBoundsOptions: { padding: 24 },
        center: data.center,
        zoom: data.zoom,
        attributionControl: false,
      });
      map = m;

      m.on("load", () => {
        // ── Boundary (contour ville) ──
        m.addSource("boundary", { type: "geojson", data: data.boundary as never });
        m.addLayer({
          id: "radar-boundary",
          type: "line",
          source: "boundary",
          paint: { "line-color": readMuted(), "line-width": 1.5, "line-dasharray": [2, 2] },
        });

        // ── TOD (périmètres) ──
        m.addSource("tod", { type: "geojson", data: data.tod as never });
        m.addLayer({
          id: TOD_FILL,
          type: "fill",
          source: "tod",
          paint: { "fill-color": readInfo(), "fill-opacity": 0.08 },
        });

        // ── Lots (couche coloriée par score — cap 200 levé) ──
        m.addSource("lots", { type: "geojson", data: data.lots as never });
        m.addLayer({
          id: LOT_FILL,
          type: "fill",
          source: "lots",
          paint: {
            "fill-color": lotFillColorExpression(container) as never,
            "fill-opacity": lotFillOpacityExpression() as never,
          },
        });
        m.addLayer({
          id: LOT_LINE,
          type: "line",
          source: "lots",
          paint: {
            "line-color": lotLineColorExpression(container) as never,
            "line-width": ["case", ["get", "priorite"], 1.4, 0.4] as never,
          },
        });

        // ── Zones (contours + labels dépendants du zoom) ──
        m.addSource("zones", { type: "geojson", data: data.zones as never });
        m.addLayer({
          id: ZONE_LINE,
          type: "line",
          source: "zones",
          paint: { "line-color": readSecondary(), "line-width": 0.8 },
        });
        m.addLayer({
          id: ZONE_LABEL,
          type: "symbol",
          source: "zones",
          minzoom: ZONE_LABEL_MINZOOM,
          layout: { "text-field": ["get", "zone"], "text-size": 11 },
          paint: { "text-color": readPrimary(), "text-halo-color": readSurface(), "text-halo-width": 1 },
        });

        // ── Interaction : clic lot → détail (noLot uniquement, anti-PII) ──
        // MapLibre type features[].properties est { [name: string]: any } ;
        // on caste vers LotLayerProps via unknown pour garder la sûreté de type côté svelte.
        m.on("click", LOT_FILL, (e: import("maplibre-gl").MapMouseEvent & { features?: import("maplibre-gl").MapGeoJSONFeature[] }) => {
          const f = e.features?.[0];
          if (f) selectedLot = f.properties as unknown as LotLayerProps;
        });
        m.on("mouseenter", LOT_FILL, () => {
          (m.getCanvas() as HTMLCanvasElement).style.cursor = "pointer";
        });
        m.on("mouseleave", LOT_FILL, () => {
          (m.getCanvas() as HTMLCanvasElement).style.cursor = "";
        });

        loading = false;
      });

      m.on("error", (e: { error?: { message?: string } }) => {
        // Erreurs de tuiles de glyphes non bloquantes : on n'écrase pas un succès.
        if (!loadError && e?.error?.message && !/glyph|font/i.test(e.error.message)) {
          loadError = e.error.message;
        }
      });
    } catch (e) {
      loadError = e instanceof Error ? e.message : "Erreur de chargement de la carte";
      loading = false;
    }
  }

  // ── Résolution des tokens DS (couleurs du chrome carto) ──
  function tok(name: string, fallback: string): string {
    if (typeof getComputedStyle === "undefined" || !container) return fallback;
    const v = getComputedStyle(container).getPropertyValue(name).trim();
    return v.length > 0 ? v : fallback;
  }
  const readSurface = () => tok("--st-semantic-surface-subtle", "#f8fafc");
  const readPrimary = () => tok("--st-semantic-text-primary", "#0f172a");
  const readSecondary = () => tok("--st-semantic-text-secondary", "#475569");
  const readMuted = () => tok("--st-semantic-text-muted", "#64748b");
  const readInfo = () => tok("--st-semantic-feedback-info", "#2563eb");

  onMount(() => {
    void initMap();
  });
  onDestroy(() => {
    if (map && typeof (map as { remove?: () => void }).remove === "function") {
      (map as { remove: () => void }).remove();
    }
  });
</script>

<div class="flex h-full w-full flex-col">
  <!-- Bandeau « provisoire » + stats ville (chrome DS) -->
  <div class="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2">
    <Layers class="h-4 w-4 text-radar-teal" aria-hidden="true" />
    <span class="text-sm font-semibold text-radar-ink">
      {resolved?.name ?? citySlug}
    </span>
    {#if resolved?.mode === "simulation"}
      <Badge tone="info" class="text-xs">Exemple (simulation)</Badge>
    {/if}
    {#if resolved}
      <span class="ml-auto flex flex-wrap items-center gap-1.5" data-testid="city-stats">
        <Badge tone="neutral" class="text-xs">{resolved.counts.lots}&nbsp;lots</Badge>
        <Badge tone="success" class="text-xs">{resolved.counts.fourPlus}&nbsp;zones 4+</Badge>
        <Badge tone="info" class="text-xs">{resolved.counts.tod}&nbsp;TOD</Badge>
        <Badge tone="warning" class="text-xs">
          <Star class="mr-0.5 inline h-3 w-3" aria-hidden="true" />{resolved.counts.priorite}&nbsp;priorité
        </Badge>
      </span>
    {/if}
  </div>

  <!-- Note provisoire (honnêteté) -->
  <p class="border-b border-amber-100 bg-amber-50 px-4 py-1 text-xs text-amber-800">
    Carte provisoire (wrapper MapLibre mince) — en attente du composant carto du
    design-system. Couleurs dérivées des tokens DS.
  </p>

  {#if loadError}
    <div class="p-4">
      <Alert tone="warning" title="Carte indisponible" message={loadError} />
    </div>
  {/if}

  <!-- Conteneur MapLibre -->
  <div class="relative min-h-[320px] flex-1">
    <div bind:this={container} class="absolute inset-0" data-testid="maplibre-container"></div>

    {#if loading && !loadError}
      <div class="absolute inset-0 flex items-center justify-center bg-slate-50/60 text-sm text-slate-400">
        Chargement de la carte…
      </div>
    {/if}

    <!-- Légende (couleurs = tokens DS via score-color-scale) -->
    {#if legend.length > 0}
      <div
        class="absolute bottom-3 left-3 rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-sm"
        data-testid="score-legend"
      >
        <p class="mb-1 font-semibold text-slate-600">Potentiel par lot</p>
        <ul class="space-y-0.5">
          {#each legend as entry (entry.label)}
            <li class="flex items-center gap-2">
              <span class="inline-block h-3 w-3 rounded-sm" style={`background:${entry.color}`}></span>
              <span class="text-slate-600">{entry.label}</span>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    <!-- Détail lot sélectionné (anti-PII : noLot + champs publics) -->
    {#if selectedLot}
      <div
        class="absolute right-3 top-3 w-56 rounded-lg border border-teal-100 bg-white/97 p-3 text-xs shadow-md"
        data-testid="lot-detail"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="flex items-center gap-1.5">
            <MapPin class="h-3.5 w-3.5 text-radar-teal" aria-hidden="true" />
            <span class="font-mono font-bold text-radar-ink">{selectedLot.noLot}</span>
          </div>
          <button
            type="button"
            class="text-slate-400 hover:text-slate-700"
            aria-label="Fermer le détail"
            on:click={() => { selectedLot = null; }}
          >✕</button>
        </div>
        <dl class="mt-2 space-y-1 text-slate-600">
          {#if selectedLot.zone}
            <div class="flex justify-between gap-2"><dt>Zone</dt><dd class="font-mono">{selectedLot.zone}</dd></div>
          {/if}
          {#if selectedLot.categorie}
            <div class="flex justify-between gap-2"><dt>Catégorie</dt><dd>{selectedLot.categorie}</dd></div>
          {/if}
          {#if selectedLot.superficieM2}
            <div class="flex justify-between gap-2"><dt>Superficie</dt><dd>{Math.round(selectedLot.superficieM2)} m²</dd></div>
          {/if}
          <div class="flex justify-between gap-2">
            <dt>Potentiel</dt>
            <dd class="font-semibold">{Math.round(selectedLot.potentialScore * 100)}%</dd>
          </div>
        </dl>
        {#if selectedLot.scorePlaceholder}
          <p class="mt-2 text-[10px] leading-tight text-amber-600">
            Score dérivé local (placeholder) — TODO brancher /api .../score.
          </p>
        {/if}
      </div>
    {/if}
  </div>
</div>
