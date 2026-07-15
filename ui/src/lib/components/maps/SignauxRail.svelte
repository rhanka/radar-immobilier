<script lang="ts">
  /**
   * SignauxRail — bande latérale gauche de la vue Signaux.
   *
   * Composé sur les briques de rail PARTAGÉES (RailShell / RailSection /
   * RailCityList — mutualisées avec la vue Sources/Couverture) :
   *   1. Section « Signaux » : mode A historique ou transition non finale.
   *   2. Section « Villes » : recherche + liste PLATE sélectionnable → flyTo.
   *      Cliquer une ville la sélectionne (highlight + ville active) ; ses
   *      signaux s'affichent à DROITE (SignauxSelPanel, bucket « Signaux »),
   *      PAS inline dans le rail (accordéon signaux supprimé).
   *
   * Les filtres DONNÉES zones/lots ne vivent PLUS ici (bloc autonome « Filtre
   * Zones et Lots » supprimé) : ils sont portés par les en-têtes des
   * accordéons Zones et Lots du drawer droit (SignauxSelPanel).
   *
   * Anti-invention : aucun appel API ici, tout par props.
   *
   * Vague 1 DS (0.34.47+) : Overline · IconButton · Checkbox (desc+trailing) ·
   * Badge tonal · StatusDot (tone) · Search fluid · Divider
   * ZÉRO couleur hex en dur · ZÉRO override composant DS · ZÉRO icône lucide
   * ZÉRO checkbox/search bespoke.
   */
  import { Badge, Radio } from "@sentropic/design-system-svelte";
  import {
    countForVivierCity,
    modeFromSubsetKey,
    subsetKeyForMode,
    type ValidatedVivierProjections,
    type VivierViewMode,
  } from "$lib/signals/vivier-view-mode.js";
  import RailShell from "$lib/components/maps/RailShell.svelte";
  import RailSection from "$lib/components/maps/RailSection.svelte";
  import RailCityList from "$lib/components/maps/RailCityList.svelte";
  import type { RailCityItem } from "$lib/maps/rail-city-items.js";
  import type { CityMapEntry } from "$lib/maps/maps-data.js";

  // ── Props ──────────────────────────────────────────────────────────────────
  /** Toutes les entrées villes (avec signalCount6m et subsetCounts). */
  export let entries: CityMapEntry[] = [];
  /** Ville actuellement sélectionnée. */
  export let selectedSlug: string | null = null;
  /** Node-validated detail projections are authoritative for the selected city. */
  export let selectedVivierProjections: ValidatedVivierProjections | null = null;
  /** Chargement de la liste principale. */
  export let loading = false;
  /** Signal data failed to load; avoid rendering a fake zero state. */
  export let dataUnavailable = false;

  /** Clé de filtre initiale (restaurée depuis l'URL au rechargement de page). */
  export let initialSubsetKey = "z|m|p";

  // ── Callbacks ──────────────────────────────────────────────────────────────
  /** Appelé quand l'utilisateur sélectionne une ville dans le rail. */
  export let onSelectCity: (entry: CityMapEntry) => void = () => {};
  /** Appelé pour actualiser les données. */
  export let onRefresh: () => void = () => {};
  export let onFilterChange: (subsetKey: string) => void = () => {};

  /**
   * Mappe le compte de signaux actifs vers un tone StatusDot DS.
   * 0 → neutral · 1–2 → warning · 3–5 → warning · >5 → error
   * (supprime signalColor hex)
   */
  function signalTone(count: number): "neutral" | "warning" | "error" {
    if (count === 0) return "neutral";
    if (count <= 5) return "warning";
    return "error";
  }

  let activeMode: VivierViewMode = modeFromSubsetKey(initialSubsetKey);
  let lastInitialKey = initialSubsetKey;
  $: if (initialSubsetKey !== lastInitialKey) {
    lastInitialKey = initialSubsetKey;
    activeMode = modeFromSubsetKey(initialSubsetKey);
  }

  $: activeKey = subsetKeyForMode(activeMode);

  function selectMode(mode: VivierViewMode): void {
    activeMode = mode;
    onFilterChange(subsetKeyForMode(mode));
  }

  // NOTE (bug #3) : on ne propage PLUS via un `$: onFilterChange(activeKey)`.
  // Ce bloc réactif tirait au MONTAGE avec la clé par défaut et écrasait le
  // filtre que le parent venait de restaurer depuis l'URL (perte au reload).
  // La propagation vient uniquement d'une sélection de mode explicite.

  // ── Compteur actif par ville = subsetCounts[clé] ──────────────────────────
  /** Helper non-réactif : compte d'une ville pour une clé subsetCounts donnée. */
  function countFor(
    entry: CityMapEntry,
    key: string,
    currentSelectedSlug: string | null,
    projections: ValidatedVivierProjections | null,
    unavailable: boolean,
  ): number | null {
    if (unavailable) return null;
    return countForVivierCity(
      entry,
      currentSelectedSlug,
      projections,
      modeFromSubsetKey(key),
    );
  }

  // ── Liste de villes (la recherche + le plafond vivent dans RailCityList) ──
  // #5 — garder la ville sélectionnée même si son compte pour le filtre actif
  // est 0 (elle reste visible/désélectionnable dans le rail).
  $: sortedEntries = entries
    .filter((e) => {
      const isSelected =
        selectedSlug !== null && e.municipality.slug === selectedSlug;
      return (countFor(e, activeKey, selectedSlug, selectedVivierProjections, dataUnavailable) ?? 0) > 0 || isSelected;
    })
    .sort((a, b) =>
      (countFor(b, activeKey, selectedSlug, selectedVivierProjections, dataUnavailable) ?? -1) -
      (countFor(a, activeKey, selectedSlug, selectedVivierProjections, dataUnavailable) ?? -1)
    );

  /** Projection générique consommée par la liste partagée RailCityList. */
  function toRailItem(
    entry: CityMapEntry,
    key: string,
    currentSelectedSlug: string | null,
    projections: ValidatedVivierProjections | null,
    unavailable: boolean,
  ): RailCityItem {
    const activeCount = countFor(entry, key, currentSelectedSlug, projections, unavailable);
    return {
      slug: entry.municipality.slug,
      name: entry.municipality.name,
      sublabel: entry.municipality.mrc ?? null,
      dotTone: signalTone(activeCount ?? 0),
      badge:
        activeCount === null
          ? { label: "n/d", tone: "neutral" }
          : activeCount > 0
          ? {
              label: String(activeCount),
              tone: "warning",
              ariaLabel: `${activeCount} signaux`,
            }
          : { label: "0", tone: "neutral" },
    };
  }

  $: railItems = sortedEntries.map((entry) =>
    toRailItem(entry, activeKey, selectedSlug, selectedVivierProjections, dataUnavailable)
  );

  function handleSelectSlug(slug: string): void {
    const entry = entries.find((e) => e.municipality.slug === slug);
    if (entry) onSelectCity(entry);
  }

  // ── Compteurs globaux (réactifs : référencent activeKey directement) ──────
  function totalFor(
    key: string,
    currentEntries: CityMapEntry[],
    currentSelectedSlug: string | null,
    projections: ValidatedVivierProjections | null,
    unavailable: boolean,
  ): number | null {
    if (unavailable) return null;
    const counts = currentEntries.map((entry) =>
      countFor(entry, key, currentSelectedSlug, projections, unavailable)
    );
    return counts.some((count) => count === null)
      ? null
      : (counts as number[]).reduce((sum, count) => sum + count, 0);
  }

  $: totalSignals = totalFor(activeKey, entries, selectedSlug, selectedVivierProjections, dataUnavailable);
  $: citiesWithSignals = totalSignals === null
    ? null
    : entries.filter((e) =>
      (countFor(e, activeKey, selectedSlug, selectedVivierProjections, dataUnavailable) ?? 0) > 0
    ).length;

  $: countA = totalFor("z|m|p", entries, selectedSlug, selectedVivierProjections, dataUnavailable);
  $: countTransition = totalFor("z|p", entries, selectedSlug, selectedVivierProjections, dataUnavailable);
</script>

<RailShell title="Signaux · Villes" {loading} {onRefresh}>
  <!-- Compteur global -->
  <svelte:fragment slot="count">
    {#if loading}
      <span class="rail-muted">Chargement…</span>
    {:else if dataUnavailable || totalSignals === null || citiesWithSignals === null}
      <span class="font-semibold text-slate-700">Données des signaux indisponibles</span>
    {:else}
      <span class="rail-count-strong">{totalSignals}</span>
      {totalSignals !== 1 ? " signaux" : " signal"}
      · <span class="rail-count-strong">{citiesWithSignals}</span> ville{citiesWithSignals !== 1 ? "s" : ""}
    {/if}
  </svelte:fragment>

  <!-- ── Section 1 : projection A / transition explicite ─────────────────── -->
  <RailSection label="Signaux">
    <div role="radiogroup" aria-label="Mode du vivier">
      <div class="axis-toggle-row">
        <Radio name="vivier-mode" label="Vivier A · référence" helperText="zonage + multifamilial 4+ + précoce" value="a" checked={activeMode === "a"} onchange={() => selectMode("a")} />
        {#if !loading}<Badge tone="info">{countA ?? "n/d"}</Badge>{/if}
      </div>
      <div class="axis-toggle-row axis-toggle-row--last">
        <Radio name="vivier-mode" label="Transition vers B" helperText="non final · zonage + précoce" value="transition" checked={activeMode === "transition"} onchange={() => selectMode("transition")} />
        {#if !loading}<Badge tone="warning">{countTransition ?? "n/d"}</Badge>{/if}
      </div>
    </div>
  </RailSection>

  <!-- ── Section 2 : Villes (recherche + liste plate sélectionnable) ─────── -->
  <!-- (Le bloc « Filtre Zones et Lots » qui vivait ici a été déplacé dans le
       drawer droit : en-têtes des accordéons Zones et Lots.) -->
  <RailSection label="Villes">
    <!-- Liste PLATE de villes : cliquer sélectionne (highlight + vol carte).
         Les signaux de la ville active vivent à DROITE (SignauxSelPanel →
         bucket « Signaux ») — plus d'accordéon inline ici. -->
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
  /* ── Modes A / transition ── */
  .axis-toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    border-bottom: 1px solid var(--st-semantic-border-subtle);
    padding: 0.4rem 0.75rem;
  }

  .axis-toggle-row--last {
    margin-bottom: 0.25rem;
  }

  /* Radio DS takes the remaining space; the badge stays trailing. */
  .axis-toggle-row :global(.st-choice) {
    flex: 1;
    min-width: 0;
    /* Compact rail typography through the DS choice token. */
    --st-component-selection-choiceLabelFontSize: var(--rail-fs-small, 0.75rem);
  }

  /* Compact helper text. */
  .axis-toggle-row :global(.st-choice__help) {
    font-size: var(--rail-fs-small, 0.75rem);
  }

  /* Badge trailing dans la rangée toggle — ne rétrécit pas */
  .axis-toggle-row :global(.st-badge) {
    flex-shrink: 0;
  }
</style>
