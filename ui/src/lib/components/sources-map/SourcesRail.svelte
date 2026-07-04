<script lang="ts">
  /**
   * SourcesRail — bande latérale gauche de la vue Sources/Couverture.
   *
   * MÊME mode d'interaction que SignauxRail (briques partagées RailShell /
   * RailSection / RailCityList) ; seul le CRITÈRE DE FILTRAGE diffère :
   * un sélecteur RADIO MUTUELLEMENT EXCLUSIF à 3 portées (coverage-scope) —
   * à la place des 3 cases à cocher combinables de Signaux :
   *   - « Focus QA : 4 villes »  (REFERENCE_CITIES — Delson, Sainte-Catherine,
   *     Saint-Constant, Candiac)
   *   - « Villes à signaux précoces »  (computeFocusScope/isFocusCity : villes
   *     portant ≥ 1 signal PRIORITAIRE z∩m∩p — zonage ∩ multifamilial 4+ ∩
   *     précoce, la cohorte « 33 »)
   *   - « Toutes »               (défaut — province entière)
   *
   * La portée choisie filtre la liste de villes ET la coloration carte
   * (l'expression d'opacité vit dans la vue). Chaque ligne ville porte la
   * pastille + le badge tri-état « Servi / Partiel / Non couvert » (couverture
   * = sémantique de la vue Sources).
   *
   * Anti-invention : aucun appel API ici, tout par props.
   */
  import { Badge, Radio } from "@sentropic/design-system-svelte";
  import RailShell from "$lib/components/maps/RailShell.svelte";
  import RailSection from "$lib/components/maps/RailSection.svelte";
  import RailCityList from "$lib/components/maps/RailCityList.svelte";
  import type { RailCityItem } from "$lib/maps/rail-city-items.js";
  import {
    colorForCity,
    computeFocusScope,
    STATE_BADGE_TONE,
    STATE_LABEL,
    type CityCoverage,
  } from "$lib/sources/source-coverage-client.js";
  import {
    cityInScope,
    countCitiesInScope,
    COVERAGE_SCOPE_OPTIONS,
    filterCitiesByScope,
    type CoverageScope,
  } from "$lib/sources/coverage-scope.js";

  // ── Props ──────────────────────────────────────────────────────────────────
  /** Toutes les villes de la couverture (non filtrées). */
  export let cities: CityCoverage[] = [];
  /** Ville actuellement sélectionnée. */
  export let selectedSlug: string | null = null;
  /** Chargement de la couverture. */
  export let loading = false;
  /** Couverture indisponible : état vide honnête, pas un faux zéro. */
  export let dataUnavailable = false;
  /** Portée active (contrôlée par la vue — pilote liste ET carte). */
  export let scope: CoverageScope = "all";

  // ── Callbacks ──────────────────────────────────────────────────────────────
  /** Changement de portée (radio EXCLUSIF). */
  export let onScopeChange: (scope: CoverageScope) => void = () => {};
  /** Sélection d'une ville dans la liste. */
  export let onSelectCity: (city: CityCoverage) => void = () => {};
  /** Actualisation des données. */
  export let onRefresh: () => void = () => {};

  // ── Liste des villes de la portée ──────────────────────────────────────────
  // Périmètre « Villes à signaux précoces » (signaux prioritaires z∩m∩p) :
  // calculé UNE fois puis passé au prédicat par ville (jamais recalculé/ville).
  $: focusScope = computeFocusScope(cities);
  // #5 (parité Signaux) : la ville sélectionnée reste listée même hors portée.
  $: scopedCities = cities
    .filter(
      (city) =>
        cityInScope(city, scope, focusScope) ||
        (selectedSlug !== null && city.citySlug === selectedSlug),
    )
    .sort(compareCities);

  /** Tri : priorityRank croissant (null en dernier), puis nom (fr). */
  function compareCities(a: CityCoverage, b: CityCoverage): number {
    const ra = a.priorityRank ?? Number.POSITIVE_INFINITY;
    const rb = b.priorityRank ?? Number.POSITIVE_INFINITY;
    if (ra !== rb) return ra - rb;
    return a.cityName.localeCompare(b.cityName, "fr");
  }

  /** Projection générique consommée par la liste partagée RailCityList. */
  function toRailItem(city: CityCoverage): RailCityItem {
    return {
      slug: city.citySlug,
      name: city.cityName,
      sublabel: city.mrc ?? null,
      dotColor: colorForCity(city),
      badge: {
        label: STATE_LABEL[city.worstStatus],
        tone: STATE_BADGE_TONE[city.worstStatus],
        ariaLabel: `Couverture : ${STATE_LABEL[city.worstStatus]}`,
      },
    };
  }

  $: railItems = scopedCities.map(toRailItem);

  function handleSelectSlug(slug: string): void {
    const city = cities.find((c) => c.citySlug === slug);
    if (city) onSelectCity(city);
  }

  // ── Compteurs (synthèse + badges des portées) ──────────────────────────────
  $: scopedServed = scopedCities.filter((c) => c.worstStatus === "verified").length;
  $: scopedPartial = scopedCities.filter((c) => c.worstStatus === "declared").length;
  $: scopeCounts = Object.fromEntries(
    COVERAGE_SCOPE_OPTIONS.map((opt) => [
      opt.value,
      countCitiesInScope(cities, opt.value),
    ]),
  ) as Record<CoverageScope, number>;
</script>

<RailShell title="Sources · Villes" {loading} {onRefresh}>
  <!-- Synthèse de la portée active (tri-état honnête, jamais un score) -->
  <svelte:fragment slot="count">
    {#if loading}
      <span class="rail-muted">Chargement…</span>
    {:else if dataUnavailable}
      <span class="font-semibold text-slate-700">Couverture indisponible</span>
    {:else}
      <span class="rail-count-strong">{scopedCities.length}</span>
      ville{scopedCities.length !== 1 ? "s" : ""}
      · <span class="rail-count-strong">{scopedServed}</span> servie{scopedServed !== 1 ? "s" : ""}
      · <span class="rail-count-strong">{scopedPartial}</span> partielle{scopedPartial !== 1 ? "s" : ""}
    {/if}
  </svelte:fragment>

  <!-- ── Section 1 : Portée — sélecteur RADIO mutuellement exclusif ──────── -->
  <RailSection label="Portée">
    <div role="radiogroup" aria-label="Portée des villes">
      {#each COVERAGE_SCOPE_OPTIONS as option (option.value)}
        <div
          class="scope-radio-row"
          class:scope-radio-row--last={option.value === "all"}
        >
          <Radio
            name="sources-scope"
            label={option.label}
            helperText={option.helperText}
            value={option.value}
            checked={scope === option.value}
            onchange={() => onScopeChange(option.value)}
          />
          {#if !loading && !dataUnavailable}
            <Badge tone="info">{scopeCounts[option.value]}</Badge>
          {/if}
        </div>
      {/each}
    </div>
  </RailSection>

  <!-- ── Section 2 : Villes (recherche + liste plate sélectionnable) ─────── -->
  <!-- Le détail de couverture de la ville active vit à DROITE (drawer =
       SourceScorecard), pas inline dans le rail. -->
  <RailSection label="Villes">
    <RailCityList
      items={railItems}
      {selectedSlug}
      {loading}
      {dataUnavailable}
      onSelect={handleSelectSlug}
    />
  </RailSection>
</RailShell>

<style>
  /* ── Rangées radio de portée (miroir des rangées toggle de Signaux) ── */
  .scope-radio-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    border-bottom: 1px solid var(--st-semantic-border-subtle);
    padding: 0.4rem 0.75rem;
  }

  .scope-radio-row--last {
    margin-bottom: 0.25rem;
  }

  /* Radio DS prend l'espace restant ; le badge reste en trailing flex-shrink:0 */
  .scope-radio-row :global(.st-choice) {
    flex: 1;
    min-width: 0;
    --st-component-selection-choiceLabelFontSize: var(--rail-fs-small, 0.75rem);
  }

  .scope-radio-row :global(.st-choice__help) {
    font-size: var(--rail-fs-small, 0.75rem);
  }

  .scope-radio-row :global(.st-badge) {
    flex-shrink: 0;
  }
</style>
