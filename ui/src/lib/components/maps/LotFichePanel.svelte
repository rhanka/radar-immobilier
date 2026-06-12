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
   * Sur < 768 px le panneau est affiché en bottom-sheet (position fixe,
   * 55 vh, swipeable via le bouton fermer) — CS-L2 S-16 bonus.
   */
  import { X, MapPin, Star, Info, ExternalLink } from "@lucide/svelte";
  import { Badge } from "@sentropic/design-system-svelte";
  import type { LotFeature } from "$lib/maps/lots-client.js";
  import {
    centroid,
    googleMapsUrl,
    scoreTone,
    scoreLabel,
  } from "$lib/components/maps/lot-fiche-utils.js";

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
  $: lotCentroid = lot ? centroid(lot) : null;
  $: mapsUrl = lotCentroid
    ? googleMapsUrl(lotCentroid.lat, lotCentroid.lon)
    : null;
</script>

{#if lot}
  <!--
    Desktop : panneau inline (dans le flux).
    Mobile  : bottom-sheet fixe (< 768 px).
  -->
  <div
    class="
      lot-fiche-panel
      fixed bottom-0 left-0 right-0 z-30
      max-h-[55vh] overflow-y-auto
      rounded-t-2xl border-t border-slate-200 bg-white shadow-2xl
      md:static md:max-h-none md:rounded-xl md:border md:shadow-sm md:z-auto
    "
    data-testid="lot-fiche-panel"
    role="region"
    aria-label="Fiche du lot {noLot}"
  >
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
          <dt class="text-slate-500">Superficie m²</dt>
          <dd class="text-slate-400 italic text-xs">non disponible (cadastre allégé)</dd>
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
      </section>

      <!-- Section Zone ────────────────────────────────────────────────────── -->
      <section aria-labelledby="section-zone">
        <h3
          id="section-zone"
          class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500"
        >
          Zone (règlement de zonage)
        </h3>
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
      </section>

      <!-- Section Notes équipe (placeholder CS-L3) ─────────────────────────── -->
      <section aria-labelledby="section-notes">
        <h3
          id="section-notes"
          class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500"
        >
          Notes équipe
        </h3>
        <div
          class="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-400 italic"
          data-testid="fiche-notes-placeholder"
        >
          Marquage équipe et notes — disponible en CS-L3 (ProspectMark).
        </div>
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
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-teal-700 transition-colors hover:border-teal-300 hover:bg-teal-50"
            data-testid="fiche-maps-link"
            aria-label="Ouvrir le lot {noLot} dans Google Maps (nouvelle fenêtre)"
          >
            <ExternalLink class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Voir dans Google Maps
          </a>
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
{/if}
