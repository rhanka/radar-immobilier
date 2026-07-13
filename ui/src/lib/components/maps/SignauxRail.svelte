<script lang="ts">
  /**
   * SignauxRail — bande latérale gauche de la vue Signaux.
   *
   * Composé sur les briques de rail PARTAGÉES (RailShell / RailSection /
   * RailCityList — mutualisées avec la vue Sources/Couverture) :
   *   1. Section « Signaux » (ouverte par défaut) :
   *      - Toggle « Zonage uniquement » (DÉFAUT ON) — filtre PRIMAIRE
   *      - Toggle « Signaux précoces » (DÉFAUT OFF) — axe ANTICIPATION
   *      - Toggle « Résidentiel pertinent » (DÉFAUT OFF) — axe PERTINENCE
   *        (masque le bruit non résidentiel ; garde résidentiel + indéterminé)
   *      Les trois toggles sont COMBINABLES ; la base de comptage est
   *      l'intersection des filtres actifs.
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
  import { Badge, Checkbox } from "@sentropic/design-system-svelte";
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
  /** Chargement de la liste principale. */
  export let loading = false;
  /** Signal data failed to load; avoid rendering a fake zero state. */
  export let dataUnavailable = false;

  /** Clé de filtre initiale (restaurée depuis l'URL au rechargement de page). */
  export let initialSubsetKey = "z|p";

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

  // ── Toggles — filtres combinables TOP-DOWN ──────────────────────────────────
  /**
   * Zonage uniquement (DÉFAUT ON) :
   *   filtre sur la clé "z" de subsetCounts
   */
  let zonageOnly = initialSubsetKey.includes("z");

  /**
   * Signaux précoces (DÉFAUT OFF — axe ANTICIPATION) :
   *   filtre sur la clé "p" de subsetCounts
   */
  let precoceOnly = initialSubsetKey.includes("p");

  /**
   * Résidentiel pertinent (DÉFAUT OFF — axe PERTINENCE) :
   *   filtre sur la clé "r" de subsetCounts. Masque le bruit EXPLICITEMENT non
   *   résidentiel (industriel / commercial / camping / environnemental) ; les
   *   signaux résidentiels ET indéterminés restent visibles (anti-faux-négatif).
   */
  let residentielOnly = initialSubsetKey.includes("r");

  /**
   * RESYNC au reload/navigation (bug #3) : `initialSubsetKey` est piloté par le
   * parent qui le recalcule au onMount (URL > localStorage > défaut). Les trois
   * `let` ci-dessus n'étant initialisés QU'UNE fois, ils restaient figés sur le
   * défaut quand le parent restaurait un filtre depuis l'URL → cases désyncs.
   * Ce bloc applique toute nouvelle `initialSubsetKey` aux cases (sans boucle :
   * il ne propage rien, il ne fait que refléter la source de vérité du parent).
   */
  let appliedInitialKey = initialSubsetKey;
  $: if (initialSubsetKey !== appliedInitialKey) {
    appliedInitialKey = initialSubsetKey;
    zonageOnly = initialSubsetKey.includes("z");
    precoceOnly = initialSubsetKey.includes("p");
    residentielOnly = initialSubsetKey.includes("r");
  }

  /** Construit la clé subsetCounts à partir des axes sélectionnables. */
  function buildKey(z: boolean, p: boolean, r: boolean): string {
    const parts: string[] = [];
    if (z) parts.push("z");
    if (p) parts.push("p");
    if (r) parts.push("r");
    return parts.join("|");
  }

  /**
   * Clé active RÉACTIVE : dépend DIRECTEMENT des 3 toggles → Svelte la
   * recalcule à chaque toggle. (Le bug venait d'une fonction qui lisait les
   * toggles « cachés » dans son corps → Svelte ne voyait aucune dépendance,
   * donc les $: total/villes/tri/filtre ne re-tournaient jamais.)
   */
  $: activeKey = buildKey(zonageOnly, precoceOnly, residentielOnly);

  function emitFilterChange(): void {
    onFilterChange(buildKey(zonageOnly, precoceOnly, residentielOnly));
  }

  function toggleZonageOnly(): void {
    zonageOnly = !zonageOnly;
    emitFilterChange();
  }

  function togglePrecoceOnly(): void {
    precoceOnly = !precoceOnly;
    emitFilterChange();
  }

  function toggleResidentielOnly(): void {
    residentielOnly = !residentielOnly;
    emitFilterChange();
  }

  // NOTE (bug #3) : on ne propage PLUS via un `$: onFilterChange(activeKey)`.
  // Ce bloc réactif tirait au MONTAGE avec la clé par défaut et écrasait le
  // filtre que le parent venait de restaurer depuis l'URL (perte au reload).
  // La propagation vers le parent vient désormais UNIQUEMENT d'un toggle
  // utilisateur explicite (toggleZonageOnly / togglePrecoceOnly /
  // toggleResidentielOnly → emitFilterChange), qui est la seule source
  // légitime d'écriture URL+LS.

  // ── Compteur actif par ville = subsetCounts[clé] ──────────────────────────
  /** Helper non-réactif : compte d'une ville pour une clé subsetCounts donnée. */
  function countFor(entry: CityMapEntry, key: string): number {
    return entry.subsetCounts[key] ?? 0;
  }

  // ── Liste de villes (la recherche + le plafond vivent dans RailCityList) ──
  // #5 — garder la ville sélectionnée même si son compte pour le filtre actif
  // est 0 (elle reste visible/désélectionnable dans le rail).
  $: sortedEntries = entries
    .filter((e) => {
      const isSelected =
        selectedSlug !== null && e.municipality.slug === selectedSlug;
      return countFor(e, activeKey) > 0 || isSelected;
    })
    .sort((a, b) => countFor(b, activeKey) - countFor(a, activeKey));

  /** Projection générique consommée par la liste partagée RailCityList. */
  function toRailItem(entry: CityMapEntry, key: string): RailCityItem {
    const activeCount = countFor(entry, key);
    return {
      slug: entry.municipality.slug,
      name: entry.municipality.name,
      sublabel: entry.municipality.mrc ?? null,
      dotTone: signalTone(activeCount),
      badge:
        activeCount > 0
          ? {
              label: String(activeCount),
              tone: "warning",
              ariaLabel: `${activeCount} signaux`,
            }
          : { label: "0", tone: "neutral" },
    };
  }

  $: railItems = sortedEntries.map((entry) => toRailItem(entry, activeKey));

  function handleSelectSlug(slug: string): void {
    const entry = entries.find((e) => e.municipality.slug === slug);
    if (entry) onSelectCity(entry);
  }

  // ── Compteurs globaux (réactifs : référencent activeKey directement) ──────
  $: totalSignals = entries.reduce((s, e) => s + countFor(e, activeKey), 0);
  $: citiesWithSignals = entries.filter((e) => countFor(e, activeKey) > 0).length;

  // ── Badges « funnel » RÉACTIFS : compte si on ajoute ce toggle à l'actif ──
  $: badgeZonage = entries.reduce(
    (s, e) => s + countFor(e, buildKey(true, precoceOnly, residentielOnly)), 0);
  $: badgePrecoce = entries.reduce(
    (s, e) => s + countFor(e, buildKey(zonageOnly, true, residentielOnly)), 0);
  $: badgeResidentiel = entries.reduce(
    (s, e) => s + countFor(e, buildKey(zonageOnly, precoceOnly, true)), 0);
</script>

<RailShell title="Signaux · Villes" {loading} {onRefresh}>
  <!-- Compteur global -->
  <svelte:fragment slot="count">
    {#if loading}
      <span class="rail-muted">Chargement…</span>
    {:else if dataUnavailable}
      <span class="font-semibold text-slate-700">Données des signaux indisponibles</span>
    {:else}
      <span class="rail-count-strong">{totalSignals}</span>
      {totalSignals !== 1 ? " signaux" : " signal"}
      · <span class="rail-count-strong">{citiesWithSignals}</span> ville{citiesWithSignals !== 1 ? "s" : ""}
    {/if}
  </svelte:fragment>

  <!-- ── Section 1 : Signaux — filtres combinables ───────────────────────── -->
  <RailSection label="Signaux">
    <!-- Toggle « Zonage uniquement » — filtre PRIMAIRE, activé par défaut -->
    <!-- Checkbox DS : label + description + trailing Badge tonal -->
    <div class="axis-toggle-row">
      <Checkbox
        label="Zonage uniquement"
        checked={zonageOnly}
        onchange={toggleZonageOnly}
      />
      {#if !loading}
        <Badge tone="info">{badgeZonage}</Badge>
      {/if}
    </div>

    <!-- Toggle « Signaux précoces » — axe ANTICIPATION (OFF par défaut) -->
    <div class="axis-toggle-row">
      <Checkbox
        label="Signaux précoces"
        helperText="avis de motion / 1er projet"
        checked={precoceOnly}
        onchange={togglePrecoceOnly}
      />
      {#if !loading}
        <Badge tone="success">{badgePrecoce}</Badge>
      {/if}
    </div>

    <!-- Toggle « Résidentiel pertinent » — axe PERTINENCE (OFF par défaut) :
         masque le bruit non résidentiel (industriel / commercial / camping /
         environnemental) ; garde résidentiel + indéterminé. -->
    <div class="axis-toggle-row axis-toggle-row--last">
      <Checkbox
        label="Résidentiel pertinent"
        helperText="masque le bruit non résidentiel"
        checked={residentielOnly}
        onchange={toggleResidentielOnly}
      />
      {#if !loading}
        <Badge tone="info">{badgeResidentiel}</Badge>
      {/if}
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
  /* ── Toggles axes (Zonage / Anticipation / Pertinence) ── */
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

  /* Checkbox DS prend l'espace restant ; le badge reste en trailing flex-shrink:0 */
  .axis-toggle-row :global(.st-choice) {
    flex: 1;
    min-width: 0;
    /* Bug 3 : réduire la taille du label via le token DS Checkbox */
    --st-component-selection-choiceLabelFontSize: var(--rail-fs-small, 0.75rem);
  }

  /* Bug 3 : réduire la taille du helper text (sous-libellé) des filtres */
  .axis-toggle-row :global(.st-choice__help) {
    font-size: var(--rail-fs-small, 0.75rem);
  }

  /* Badge trailing dans la rangée toggle — ne rétrécit pas */
  .axis-toggle-row :global(.st-badge) {
    flex-shrink: 0;
  }
</style>
