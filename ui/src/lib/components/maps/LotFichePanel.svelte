<script lang="ts">
  /**
   * LotFichePanel — Fiche lot complète — CS-L2 (S-2).
   *
   * Affiche, au clic sur un lot dans la vue Évaluation, les données
   * publiques du lot (cadastre + score de potentiel).
   *
   * ## Champs affichés (tous publics, anti-PII Loi 25)
   * - Cadastre : noLot (NO_LOT MRNF), superficieM2 (non disponible depuis MRNF
   *   allégé — géométrie déjà sur la carte)
   * - Score de potentiel : potentialScore (0–10, distinct du 0-5 T2)
   * - Lien Google Maps (lat/lon centroïde du lot)
   * - Zone notes : placeholder CS-L3 (pas d'implémentation ici)
   *
   * ## Anti-PII strict (Loi 25)
   * Le cadastre allégé MRNF ne contient QUE le NO_LOT.
   * Aucun nom de propriétaire, aucune adresse, aucune PII n'est
   * affichée — le backend ne les expose pas.
   *
   * ## Champs NON affichés ici (données non disponibles sans backend enrichi)
   * - Rôle MAMH (usageCode, valeurs d'évaluation, densité) : nécessite
   *   l'extraction rôle MAMH — non disponible dans le cadastre allégé MRNF.
   * - ZoneVersion (kind, usages, densiteLogHa) : non retourné par l'endpoint
   *   /api/geo/:city/lots actuellement (ni zone code ni lien grille PDF).
   * Ces données sont prévues par SPEC_DESIGN_DATA_MODEL §1.1–1.4 mais
   * l'endpoint ne les expose pas encore — anti-invention : on n'affiche
   * que ce qui existe réellement dans la réponse.
   *
   * ## Mobile
   * Sur < 768 px le panneau est affiché via Drawer DS. La version DS courante
   * expose seulement les côtés gauche/droite; le bottom sheet reste dépendant
   * d'une vague DS ultérieure. Sur desktop (md+), Card DS.
   */
  import { X, MapPin, Star, Info, ExternalLink, MessageSquare } from "@lucide/svelte";
  import { Badge, Card, Drawer } from "@sentropic/design-system-svelte";
  import type { LotFeature } from "$lib/maps/lots-client.js";
  import {
    centroid,
    googleMapsUrl,
    googleStreetViewUrl,
    scoreTone,
    scoreLabel,
  } from "$lib/components/maps/lot-fiche-utils.js";
  import {
    activeMarketMark,
    activePipelineMark,
    fetchProspectLotState,
    prospectStatusLabel,
    type ProspectMark,
    type ProspectNote,
  } from "$lib/prospect/prospect-marks-client.js";

  // ── Props ────────────────────────────────────────────────────────────────────

  /** Le lot sélectionné (null = panneau fermé). */
  export let lot: LotFeature | null = null;

  /** Nom de la ville (pour l'affichage et le lien Maps). */
  export let cityName: string = "";

  /** Callback de fermeture. */
  export let onClose: () => void = () => {};

  // ── Dérivés réactifs ─────────────────────────────────────────────────────────

  $: noLot = lot?.properties.noLot ?? "";
  $: potentialScore = lot?.properties.potentialScore;
  $: superficieM2 = lot?.properties.superficieM2;
  $: valuation = lot?.properties.valuation;
  $: zone = lot?.properties.zone;
  $: zoneCode = lot?.properties.zoneCode ?? zone?.code;
  $: grillePdfUrl = lot?.properties.grillePdfUrl ?? zone?.grillePdfUrl;
  $: lotCentroid = lot ? centroid(lot) : null;
  let prospectLoading = false;
  let prospectError: string | null = null;
  let prospectMarks: ProspectMark[] = [];
  let prospectNotes: ProspectNote[] = [];
  let prospectRequestKey = "";

  $: citySlug = lot?.properties.citySlug ?? "";
  $: mapsUrl = lotCentroid
    ? googleMapsUrl(lotCentroid.lat, lotCentroid.lon)
    : null;
  $: streetViewUrl = lotCentroid
    ? googleStreetViewUrl(lotCentroid.lat, lotCentroid.lon)
    : null;
  $: drawerOpen = lot !== null;
  $: pipelineMark = activePipelineMark(prospectMarks);
  $: marketMark = activeMarketMark(prospectMarks);
  $: latestNotes = [...prospectNotes]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 3);

  $: {
    const key = noLot && citySlug ? `${citySlug}::${noLot}` : "";
    if (key && key !== prospectRequestKey) {
      prospectRequestKey = key;
      void loadProspectState(noLot, citySlug);
    } else if (!key && prospectRequestKey) {
      prospectRequestKey = "";
      prospectMarks = [];
      prospectNotes = [];
      prospectError = null;
      prospectLoading = false;
    }
  }

  function formatArea(value: number | null | undefined): string {
    if (value === null || value === undefined) return "non disponible";
    return `${Math.round(value).toLocaleString("fr-CA")} m²`;
  }

  function formatMoney(value: number | null | undefined): string {
    if (value === null || value === undefined) return "non disponible";
    return new Intl.NumberFormat("fr-CA", {
      style: "currency",
      currency: "CAD",
      maximumFractionDigits: 0,
    }).format(value);
  }

  async function loadProspectState(noLotValue: string, citySlugValue: string): Promise<void> {
    prospectLoading = true;
    prospectError = null;
    try {
      const state = await fetchProspectLotState(noLotValue, citySlugValue);
      if (prospectRequestKey !== `${citySlugValue}::${noLotValue}`) return;
      prospectMarks = state.marks;
      prospectNotes = state.notes;
    } catch (e) {
      if (prospectRequestKey !== `${citySlugValue}::${noLotValue}`) return;
      prospectMarks = [];
      prospectNotes = [];
      prospectError = e instanceof Error ? e.message : "Marquage indisponible";
    } finally {
      if (prospectRequestKey === `${citySlugValue}::${noLotValue}`) {
        prospectLoading = false;
      }
    }
  }
</script>

{#if lot}
  <!--
    Mobile (<768px) : Drawer DS.
    Desktop (md+) : Card DS — panneau inline dans le flux.
  -->

  <!-- Mobile : Drawer DS (masqué sur desktop via wrapper md:hidden) -->
  <div class="md:hidden">
    <Drawer
      open={drawerOpen}
      title="Fiche lot {noLot}"
      description="Cadastre allégé MRNF · Anti-PII Loi 25"
      side="right"
      closeLabel="Fermer la fiche lot"
      onclose={onClose}
      data-testid="lot-fiche-panel-mobile"
    >
      {#snippet children()}
        <div class="space-y-4" data-testid="lot-fiche-panel-mobile-body">
          <!-- N° lot -->
          <p class="text-xs text-slate-500">
            N° lot : <span class="font-mono font-semibold text-slate-900" data-testid="fiche-nolot-mobile">{noLot}</span>
          </p>

          <!-- Score -->
          {#if potentialScore !== undefined}
            <div class="flex items-center gap-2" data-testid="fiche-score-mobile">
              <span class="text-2xl font-bold text-slate-900">
                {potentialScore}<span class="text-sm font-normal text-slate-400">/10</span>
              </span>
              <Badge tone={scoreTone(potentialScore)}>{scoreLabel(potentialScore)}</Badge>
            </div>
          {/if}

          <!-- Lien Maps -->
          {#if mapsUrl}
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-teal-700 hover:border-teal-300 hover:bg-teal-50"
              data-testid="fiche-maps-link-mobile"
              aria-label="Ouvrir le lot {noLot} dans Google Maps (nouvelle fenêtre)"
            >
              <ExternalLink class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Voir dans Google Maps
            </a>
          {/if}

          <!-- Note anti-PII -->
          <p class="text-xs text-slate-300 border-t border-slate-100 pt-3">
            Anti-PII (Loi 25) : aucun nom de propriétaire ni donnée personnelle n'est affichée.
          </p>
        </div>
      {/snippet}
    </Drawer>
  </div>

  <!-- Desktop : Card DS (md+) -->
  <Card class="hidden md:block overflow-hidden" data-testid="lot-fiche-panel">
    <div role="region" aria-label="Fiche du lot {noLot}">
    <!-- ── En-tête ─────────────────────────────────────────────────────────── -->
    <div
      class="
        sticky top-0 z-10
        flex items-center justify-between gap-3
        border-b border-teal-100 bg-teal-50 px-4 py-3
      "
    >
      <div class="flex items-center gap-2 min-w-0">
        <MapPin class="h-4 w-4 text-teal-600 shrink-0" aria-hidden="true" />
        <div class="min-w-0">
          <p class="text-xs text-teal-600 font-medium uppercase tracking-wide">Fiche lot</p>
          <p class="font-mono text-base font-bold text-teal-900 truncate" data-testid="fiche-nolot">
            {noLot}
          </p>
        </div>
      </div>
      <button
        type="button"
        class="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-teal-100 hover:text-teal-700 shrink-0"
        on:click={onClose}
        aria-label="Fermer la fiche lot"
      >
        <X class="h-4 w-4" aria-hidden="true" />
      </button>
    </div>

    <!-- ── Corps ──────────────────────────────────────────────────────────── -->
    <div class="p-4 space-y-4">

      <!-- Section Cadastre ────────────────────────────────────────────────── -->
      <section aria-labelledby="section-cadastre">
        <h3
          id="section-cadastre"
          class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-1"
        >
          Cadastre
        </h3>
        <dl class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt class="text-slate-500">N° lot</dt>
          <dd class="font-mono font-medium text-slate-900" data-testid="fiche-nolot-dd">
            {noLot}
          </dd>
          <dt class="text-slate-500">Source</dt>
          <dd class="text-slate-700">Cadastre allégé MRNF</dd>
          {#if lot?.properties.citySlug}
            <dt class="text-slate-500">Ville</dt>
            <dd class="text-slate-700">{cityName || lot.properties.citySlug}</dd>
          {/if}
          <dt class="text-slate-500">Superficie</dt>
          <dd class:text-slate-700={superficieM2 !== undefined && superficieM2 !== null} class:text-slate-400={superficieM2 === undefined || superficieM2 === null} class:italic={superficieM2 === undefined || superficieM2 === null} class="text-xs">
            {formatArea(superficieM2)}
          </dd>
        </dl>
      </section>

      <!-- Section Score de potentiel ──────────────────────────────────────── -->
      <section aria-labelledby="section-score">
        <h3
          id="section-score"
          class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-1"
        >
          <Star class="h-3.5 w-3.5 text-amber-500 shrink-0" aria-hidden="true" />
          Score de potentiel
        </h3>

        {#if potentialScore !== undefined}
          <div class="flex items-center gap-3" data-testid="fiche-score">
            <span class="text-2xl font-bold text-slate-900">
              {potentialScore}<span class="text-sm font-normal text-slate-400">/10</span>
            </span>
            <Badge tone={scoreTone(potentialScore)}>
              {scoreLabel(potentialScore)}
            </Badge>
          </div>
          <p class="mt-1.5 text-xs text-slate-400">
            Échelle 0–10 · distinct du score T2 (0-5) et du score legacy (0-100).
            Basé sur la densité de zone, le type, la présence en périmètre TOD.
          </p>
        {:else}
          <div
            class="flex items-start gap-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800"
            data-testid="fiche-score-na"
          >
            <Info class="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-500" aria-hidden="true" />
            <p>
              Score non disponible — l'endpoint n'a pas encore reçu le contexte de zone
              (feat/api-score-potentiel-lot).
            </p>
          </div>
        {/if}
      </section>

      <!-- Section Rôle MAMH (champs publics) ──────────────────────────────── -->
      <section aria-labelledby="section-role">
        <h3
          id="section-role"
          class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500"
        >
          Rôle MAMH (évaluation foncière)
        </h3>
        {#if valuation}
          <dl class="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border border-slate-100 bg-white px-3 py-2 text-sm" data-testid="fiche-role">
            <dt class="text-slate-500">Usage</dt>
            <dd class="text-slate-700">{valuation.usageCode ?? lot.properties.usageCode ?? "non disponible"}</dd>
            <dt class="text-slate-500">Catégorie</dt>
            <dd class="text-slate-700">{valuation.categorie ?? "non disponible"}</dd>
            <dt class="text-slate-500">Valeur totale</dt>
            <dd class="text-slate-700">{formatMoney(valuation.valeurTotale)}</dd>
            <dt class="text-slate-500">Terrain</dt>
            <dd class="text-slate-700">{formatMoney(valuation.valeurTerrain)}</dd>
            <dt class="text-slate-500">Bâtiment</dt>
            <dd class="text-slate-700">{formatMoney(valuation.valeurBatiment)}</dd>
            <dt class="text-slate-500">Logements / étages</dt>
            <dd class="text-slate-700">{valuation.nbLogements ?? "?"} / {valuation.nbEtages ?? "?"}</dd>
          </dl>
          <p class="mt-1.5 text-xs text-slate-400">Champs publics seulement; aucun propriétaire/adresse nominative.</p>
        {:else}
          <div
            class="flex items-start gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-500"
            data-testid="fiche-role-na"
          >
            <Info class="h-3.5 w-3.5 shrink-0 mt-0.5 text-slate-400" aria-hidden="true" />
            <p>
              Données rôle MAMH non disponibles (usageCode, valeurTotale, valeurTerrain,
              valeurBatiment, densité) — extraction rôle non réalisée pour cette ville.
              Seuls les champs publics seront affichés (aucun nom de propriétaire — Loi 25).
            </p>
          </div>
        {/if}
      </section>

      <!-- Section Zone ────────────────────────────────────────────────────── -->
      <section aria-labelledby="section-zone">
        <h3
          id="section-zone"
          class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500"
        >
          Zone (règlement de zonage)
        </h3>
        {#if zone || zoneCode || grillePdfUrl}
          <div class="space-y-2 rounded-lg border border-slate-100 bg-white px-3 py-2" data-testid="fiche-zone">
            <dl class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <dt class="text-slate-500">Code zone</dt>
              <dd class="font-mono text-slate-700">{zoneCode ?? "non disponible"}</dd>
              <dt class="text-slate-500">Type</dt>
              <dd class="text-slate-700">{zone?.kind ?? "non disponible"}</dd>
              <dt class="text-slate-500">Densité</dt>
              <dd class="text-slate-700">{zone?.densiteLogHa ?? "non disponible"}{zone?.densiteLogHa !== null && zone?.densiteLogHa !== undefined ? " log/ha" : ""}</dd>
              <dt class="text-slate-500">Usages</dt>
              <dd class="text-slate-700">{zone?.usages?.length ? zone.usages.join(", ") : "non disponible"}</dd>
            </dl>
            {#if grillePdfUrl}
              <a
                href={grillePdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-teal-700 transition-colors hover:border-teal-300 hover:bg-teal-50"
                data-testid="fiche-grille-pdf-link"
              >
                <ExternalLink class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Ouvrir la grille de zonage PDF
              </a>
            {/if}
          </div>
        {:else}
          <div
            class="flex items-start gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-500"
            data-testid="fiche-zone-na"
          >
            <Info class="h-3.5 w-3.5 shrink-0 mt-0.5 text-slate-400" aria-hidden="true" />
            <p>
              ZoneVersion non disponible (kind, usages, densiteLogHa) — le lot-zone
              resolution n'est pas encore retourné par l'endpoint.
              Le lien grille PDF sera affiché ici lorsque disponible (artefact source A2/B2).
            </p>
          </div>
        {/if}
      </section>

      <!-- Section Marquage équipe + notes (CS-L3) ─────────────────────────── -->
      <section aria-labelledby="section-notes">
        <h3
          id="section-notes"
          class="mb-2 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500"
        >
          <MessageSquare class="h-3.5 w-3.5 text-teal-600 shrink-0" aria-hidden="true" />
          Marquage équipe & notes
        </h3>

        {#if !citySlug}
          <div
            class="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-500"
            data-testid="fiche-prospect-city-missing"
          >
            Marquage indisponible : citySlug absent du lot GeoJSON.
          </div>
        {:else if prospectLoading}
          <div
            class="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-400"
            data-testid="fiche-prospect-loading"
          >
            Chargement des marques et notes…
          </div>
        {:else if prospectError}
          <div
            class="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800"
            data-testid="fiche-prospect-error"
          >
            Marquage/notes indisponibles — {prospectError}.
          </div>
        {:else}
          <div class="space-y-3" data-testid="fiche-prospect-state">
            <div class="flex flex-wrap gap-1.5">
              {#if pipelineMark}
                <Badge tone={pipelineMark.statut === "ecarte" ? "neutral" : "success"} class="text-xs">
                  Pipeline : {prospectStatusLabel(pipelineMark.statut)}
                </Badge>
              {:else}
                <Badge tone="neutral" class="text-xs">Pipeline : non marqué</Badge>
              {/if}
              {#if marketMark}
                <Badge tone="warning" class="text-xs">Marché : {prospectStatusLabel(marketMark.statut)}</Badge>
              {/if}
              <Badge tone="neutral" class="text-xs">{prospectNotes.length} note{prospectNotes.length !== 1 ? "s" : ""}</Badge>
            </div>

            {#if latestNotes.length > 0}
              <ul class="space-y-1.5" aria-label="Dernières notes équipe">
                {#each latestNotes as note (note.id)}
                  <li class="rounded-lg border border-slate-100 bg-white px-3 py-2 text-xs text-slate-600">
                    <p class="whitespace-pre-wrap leading-snug">{note.body}</p>
                    <p class="mt-1 text-[11px] text-slate-400">
                      {new Date(note.createdAt).toLocaleString("fr-CA")} · {note.mode === "simulation" ? "simulation" : "réel"}
                    </p>
                  </li>
                {/each}
              </ul>
            {:else}
              <p class="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-400 italic">
                Aucune note pour ce lot.
              </p>
            {/if}

            <p class="text-xs text-slate-400">
              Écriture append-only via l'API ProspectMark. Les boutons d'édition seront activés lorsque le lot GeoJSON exposera son lotVersionId.
            </p>
          </div>
        {/if}
      </section>

      <!-- Section Lien Google Maps ─────────────────────────────────────────── -->
      {#if mapsUrl}
        <section aria-labelledby="section-maps">
          <h3
            id="section-maps"
            class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500"
          >
            Géolocalisation
          </h3>
          <div class="flex flex-wrap gap-2">
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-teal-700 transition-colors hover:border-teal-300 hover:bg-teal-50"
              data-testid="fiche-maps-link"
              aria-label="Ouvrir le lot {noLot} dans Google Maps (nouvelle fenêtre)"
            >
              <ExternalLink class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Google Maps
            </a>
            {#if streetViewUrl}
              <a
                href={streetViewUrl}
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-teal-700 transition-colors hover:border-teal-300 hover:bg-teal-50"
                data-testid="fiche-streetview-link"
                aria-label="Ouvrir Street View près du lot {noLot} (nouvelle fenêtre)"
              >
                <ExternalLink class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Street View
              </a>
            {/if}
          </div>
          {#if lotCentroid}
            <p class="mt-1 text-xs text-slate-400">
              Centroïde approché : {lotCentroid.lat.toFixed(5)}°N, {lotCentroid.lon.toFixed(5)}°E
            </p>
          {/if}
        </section>
      {/if}

      <!-- Note anti-PII ───────────────────────────────────────────────────── -->
      <p class="text-xs text-slate-300 border-t border-slate-100 pt-3">
        Anti-PII (Loi 25) : aucun nom de propriétaire ni donnée personnelle n'est affichée.
        Données cadastrales publiques MRNF.
      </p>
    </div>
    </div>
  </Card>
{/if}
