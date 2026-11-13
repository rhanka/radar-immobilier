<script lang="ts">
  /**
   * SignauxRail — bande latérale gauche de la vue Signaux.
   *
   * Composé sur les briques de rail PARTAGÉES (RailShell / RailSection /
   * RailCityList — mutualisées avec la vue Sources/Couverture) :
   *   1. Section « Signaux » : la vue UNIQUE « Nouveau B » (le vivier v2,
   *      zonage ∩ résidentiel). Trois axes COMBINABLES (Zonage · Résidentiel ·
   *      Précoce), tous cochés par défaut, + deux exclusions d'affichage. Plus
   *      aucun bandeau à onglets ni pipeline « Référence A » : le panneau B est
   *      rendu directement. La migration d'une clé A persistée → B vit dans
   *      `vivier-view-mode.ts` (`initialVivierSubsetKey`).
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
   * Vague 1 DS (0.34.47+) : Checkbox (desc+trailing) · Badge tonal ·
   * StatusDot (tone) · Search fluid · Divider
   * ZÉRO couleur hex en dur · ZÉRO override composant DS · ZÉRO icône lucide
   * ZÉRO checkbox/tabs/search bespoke.
   */
  import { Badge, Checkbox, RadioGroup, TimeRangePicker } from "@sentropic/design-system-svelte";
  import { ChevronDown } from "@lucide/svelte";
  import {
    B_SUBSET_KEY,
    bAxesFromVivierKey,
    countForVivierCity,
    DEFAULT_B_AXES,
    keyForVivierB,
    type BAxes,
  } from "$lib/signals/vivier-view-mode.js";
  import {
    DEFAULT_VIVIER_B_EXCLUSIONS,
    type VivierBExclusions,
    type DocumentDateBasis,
  } from "@radar/domain";
  import {
    defaultSignalTimeRange,
    formatSignalTimeRange,
    SIGNAL_TIME_RANGE_PRESETS,
    type SignalTimeRange,
  } from "$lib/signals/signal-date-filter.js";
  import {
    CLASSEMENT_META,
    DEFAULT_CLASSEMENT_FILTER,
    SIGNAL_CLASSES,
    type ClassementFilter,
    type SignalClass,
  } from "$lib/signals/signal-classement.js";
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
  export let citySearch = "";
  export let onCitySearchChange: (query: string) => void = () => {};

  /**
   * Clé de MODE initiale (toujours une clé B `vivier-v2*` après migration),
   * restaurée depuis l'URL/localStorage au rechargement. Elle ne change que sur
   * une navigation externe — jamais sur une simple recomposition d'axes : c'est
   * ce qui permet à la sous-sélection LIVE de survivre. Une clé A résiduelle est
   * dégradée vers le défaut B (filet de migration), jamais un panneau blanc.
   */
  export let initialSubsetKey: string = B_SUBSET_KEY;

  /** Exclusions d'affichage de la vue B (cochées par défaut, décochables). */
  export let exclusions: VivierBExclusions = { ...DEFAULT_VIVIER_B_EXCLUSIONS };

  /** Parent-owned DS temporal selection shared by both Vivier tabs. */
  export let timeRange: SignalTimeRange = defaultSignalTimeRange();
  export let dateBasis: DocumentDateBasis = "document";
  /**
   * Date basis only applies to a custom period (owner decision): a relative
   * preset always reads document dates. The choice lives in the « Personnalisé »
   * tab of the DS picker (`customExtra` slot), above Début / Fin, and is staged
   * with the range: the radio edits a DRAFT reseeded on every open, committed
   * only by « Appliquer » (the DS emits an absolute range on Apply only), and
   * discarded by Annuler / Échap / outside click. It is never rendered in the
   * rail itself. The internal value stays `scrap` (API contract); the UI only
   * ever says « Date d'acquisition ».
   */
  const DATE_BASIS_ITEMS = [
    { value: "document", label: "Date du document" },
    { value: "scrap", label: "Date d'acquisition" },
  ];
  let draftDateBasis: DocumentDateBasis = dateBasis;
  function handleTimeRangePickerOpen(open: boolean): void {
    if (open) draftDateBasis = dateBasis;
  }
  function selectDraftDateBasis(next: string): void {
    if (next === "document" || next === "scrap") draftDateBasis = next;
  }
  function handleTimeRangePick(next: SignalTimeRange): void {
    onTimeRangeChange(next, next.mode === "absolute" ? draftDateBasis : "document");
  }

  /**
   * m1.7 — Compte LIVE de `selectedSlug`, calculé par le parent sur les mêmes
   * nœuds détail que le panneau droit (`filteredDetailNodes.length` : axes +
   * exclusions B). `null` tant que ce compte n'est pas
   * disponible (aucune ville sélectionnée, détail en cours de chargement, ou
   * projection serveur indisponible) → repli sur le compte bulk, comme avant.
   *
   * Portée VOLONTAIREMENT limitée à la ville sélectionnée : c'est la seule
   * pour laquelle le détail nœud par nœud est chargé côté client ; les autres
   * lignes du rail restent sur le compte bulk serveur (aucun fetch masqué par
   * ville pour un badge).
   */
  export let selectedCityLiveCount: number | null = null;

  // ── Callbacks ──────────────────────────────────────────────────────────────
  /** Appelé quand l'utilisateur sélectionne une ville dans le rail. */
  export let onSelectCity: (entry: CityMapEntry) => void = () => {};
  /** Appelé pour actualiser les données. */
  export let onRefresh: () => void = () => {};
  /** Appelé avec la clé LIVE composée (tab + sous-sélection). */
  export let onFilterChange: (subsetKey: string) => void = () => {};
  /** Appelé quand une exclusion d'affichage de B est cochée/décochée. */
  export let onExclusionsChange: (next: VivierBExclusions) => void = () => {};
  /**
   * Called when the canonical DS temporal control commits a range: a relative
   * preset (basis forced to `document`) or « Appliquer » on a custom period
   * (basis = the staged « Base de date » choice). One call, so the parent
   * reloads once for the range and its basis together.
   */
  export let onTimeRangeChange: (next: SignalTimeRange, basis: DocumentDateBasis) => void = () => {};

  /** Classement filter (spec 2026-11-08): checked by default except Écarté. */
  export let classementFilter: ClassementFilter = { ...DEFAULT_CLASSEMENT_FILTER };
  export let classementCounts: Record<SignalClass, number> = {
    pertinent: 0, a_surveiller: 0, non_classe: 0, ecarte: 0,
  };
  export let onClassementFilterChange: (next: ClassementFilter) => void = () => {};

  /**
   * Filtre counts (owner 2026-11-09): per-axis / per-exclusion counts within
   * the current scope (period + Pertinence), computed by the parent from the
   * selected city's loaded detail. `null` when no exact count is available
   * (no classification) → pills are hidden rather than partial.
   */
  export let filtreCounts: import("$lib/signals/signal-filter-counts.js").FiltreCounts | null = null;

  function toggleClassement(classe: SignalClass, checked: boolean): void {
    onClassementFilterChange({ ...classementFilter, [classe]: checked });
  }

  // Pertinence dropdown (owner 09/11): closed trigger summarising the checked
  // classes by name (no counter), opening a multi-checkbox panel whose counts
  // sit in right-aligned orange pills. Default: all except Écarté.
  let classementOpen = false;
  let classementWrapEl: HTMLElement | null = null;
  $: classementSummary = SIGNAL_CLASSES.filter((classe) => classementFilter[classe])
    .map((classe) => CLASSEMENT_META[classe].label)
    .join(", ") || "Aucune sélection";

  function onClassementWindowClick(event: MouseEvent): void {
    if (
      classementOpen &&
      classementWrapEl &&
      event.target instanceof Node &&
      !classementWrapEl.contains(event.target)
    ) {
      classementOpen = false;
    }
  }
  function onClassementWindowKey(event: KeyboardEvent): void {
    if (classementOpen && event.key === "Escape") classementOpen = false;
    if (filtreOpen && event.key === "Escape") filtreOpen = false;
  }

  // Filtre (axes + exclusions) as a second dropdown with the same DS field
  // pattern as Pertinence: same label typography, same DS chevron, closed
  // summary truncated with a single-line ellipsis.
  let filtreOpen = false;
  let filtreWrapEl: HTMLElement | null = null;
  const FILTRE_LABELS = {
    z: "Zonage",
    r: "Résidentiel",
    p: "Précoce",
    piia: "Exclure PIIA sans projet résidentiel",
    derog: "Exclure dérogations mineures",
  } as const;
  $: filtreSummary = [
    ...(bAxes.z ? [FILTRE_LABELS.z] : []),
    ...(bAxes.r ? [FILTRE_LABELS.r] : []),
    ...(bAxes.p ? [FILTRE_LABELS.p] : []),
    ...(exclusions.piiaSansProjetResidentiel ? [FILTRE_LABELS.piia] : []),
    ...(exclusions.derogationsMineures ? [FILTRE_LABELS.derog] : []),
  ].join(", ") || "Aucune sélection";

  function onFiltreWindowClick(event: MouseEvent): void {
    if (
      filtreOpen &&
      filtreWrapEl &&
      event.target instanceof Node &&
      !filtreWrapEl.contains(event.target)
    ) {
      filtreOpen = false;
    }
  }

  // Refresh before opening, then keep the bound stable during selection.
  // Invalidating DS 0.37.2's presets on option pointerdown loses registered
  // rows before their click (only the final "all" row remains selectable).
  let timeRangeMax = Date.now();
  function refreshTimeRangeMax(event: Event): void {
    if (!(event.target instanceof Element)) return;
    const trigger = event.target.closest(".signals-time-range-picker .st-timeRangePicker__trigger");
    if (!trigger || trigger.getAttribute("aria-expanded") !== "false") return;
    if (event instanceof KeyboardEvent && event.key !== "Enter" && event.key !== " ") return;
    timeRangeMax = Date.now();
  }

  // The DS period overlay is NOT moved out of the rail. Since
  // @sentropic/design-system-svelte 0.37, MenuPopover keeps its panel in place
  // and lifts it into the top layer with the Popover API (`popover="manual"` +
  // `showPopover()`): it escapes the rail clipping and keeps the theme tokens
  // by itself. Re-parenting a shown popover removes it from the document, and
  // the browser then hides it (`display: none`): the picker never unfolded.

  function setExclusion(patch: Partial<VivierBExclusions>): void {
    exclusions = { ...exclusions, ...patch };
    onExclusionsChange(exclusions);
  }

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

  // ── État LIVE de la vue B (owned by the rail) ─────────────────────────────
  // La sous-sélection d'axes B vit ICI. Le parent renvoie la clé LIVE composée
  // via `initialSubsetKey` : on en DÉRIVE les axes (idempotent — renvoyer
  // `vivier-v2|p` re-produit exactement les mêmes axes, donc pas de boucle).
  // Quand le parent COLLAPSE la clé (navigation/reload → défaut B), rail et
  // carte restent synchrones : les deux repartent du même défaut B. Une clé A
  // résiduelle (hors namespace `vivier-v2`) est dégradée vers le défaut B.
  function bAxesFor(key: string): BAxes {
    return key.startsWith(B_SUBSET_KEY) ? bAxesFromVivierKey(key) : { ...DEFAULT_B_AXES };
  }
  let bAxes: BAxes = bAxesFor(initialSubsetKey);
  let lastInitialKey = initialSubsetKey;
  $: if (initialSubsetKey !== lastInitialKey) {
    lastInitialKey = initialSubsetKey;
    bAxes = bAxesFor(initialSubsetKey);
  }

  /** Clé LIVE composée des trois axes de B (zonage/résidentiel/précoce). */
  $: activeKey = keyForVivierB(bAxes);

  /** Coche/décoche un axe de B (zonage/résidentiel/précoce) : recompose et propage. */
  function toggleBAxis(patch: Partial<BAxes>): void {
    bAxes = { ...bAxes, ...patch };
    onFilterChange(keyForVivierB(bAxes));
  }

  // ── Compteur actif par ville = compte bulk de la clé LIVE ──────────────────
  /**
   * Compte BULK serveur d'une ville pour la clé LIVE donnée (`null` seulement
   * si les données sont indisponibles → badge « n/d »).
   *
   * C'est le SEUL compte admis pour l'APPARTENANCE et le TRI de la liste : il
   * ne varie ni pendant un fetch détail ni avec les lentilles client (axes,
   * exclusions B), donc une ligne — sélectionnée ou non — ne
   * saute jamais de position et n'est jamais éjectée par la coupe au plafond
   * (régression #378 : le compte live de la ville sélectionnée participait au
   * tri → re-tri en bas + coupe au plafond dès la fin du fetch).
   */
  function bulkCountFor(
    entry: CityMapEntry,
    key: string,
    unavailable: boolean,
  ): number | null {
    if (unavailable) return null;
    return countForVivierCity(entry, key);
  }

  /**
   * Helper non-réactif : compte AFFICHÉ d'une ville pour la clé LIVE donnée.
   * Réservé aux BADGES et aux compteurs agrégés de l'en-tête — jamais au tri
   * ni au filtre d'appartenance (cf. `bulkCountFor`).
   *
   * Pour toute ville AUTRE que `selectedSlug`, le compte reste le bulk serveur :
   * sélectionner une ville ne doit jamais faire varier (ni suspendre) le compte
   * d'une AUTRE ville. Seul un échec de chargement (`unavailable`) rend le
   * compte inconnu → `null` → badge « n/d ».
   *
   * m1.7 — Pour la ville SÉLECTIONNÉE, quand `liveCount` est disponible (le
   * parent l'a calculé sur les mêmes nœuds détail que le panneau droit : axes
   * + exclusions B), on l'utilise à la place du bulk : c'est
   * le seul badge où le client a déjà le détail nœud par nœud, donc le seul
   * qu'on peut faire correspondre EXACTEMENT à ce que l'utilisateur voit dans
   * la liste. `liveCount` reste `null` pendant le chargement (le parent ne
   * l'expose qu'une fois la projection disponible) → repli sur le bulk, sans
   * jamais faire disparaître ni clignoter la ligne (cf. #378).
   */
  function countFor(
    entry: CityMapEntry,
    key: string,
    unavailable: boolean,
    liveCount: number | null,
    liveSlug: string | null,
  ): number | null {
    if (unavailable) return null;
    if (liveCount !== null && liveSlug !== null && entry.municipality.slug === liveSlug) {
      return liveCount;
    }
    return countForVivierCity(entry, key);
  }

  // ── Liste de villes (la recherche vit dans RailCityList — liste complète) ──
  // #5 — garder la ville sélectionnée même si son compte pour le filtre actif
  // est 0 (elle reste visible/désélectionnable dans le rail).
  // #378 — appartenance et TRI par compte BULK uniquement : le compte live de
  // la ville sélectionnée ne participe JAMAIS à l'ordre (sinon sa ligne saute
  // ou disparaît à la fin du fetch détail).
  $: sortedEntries = entries
    .filter((e) => {
      const isSelected =
        selectedSlug !== null && e.municipality.slug === selectedSlug;
      return (bulkCountFor(e, activeKey, dataUnavailable) ?? 0) > 0 || isSelected;
    })
    .sort((a, b) =>
      (bulkCountFor(b, activeKey, dataUnavailable) ?? -1) -
      (bulkCountFor(a, activeKey, dataUnavailable) ?? -1)
    );

  /**
   * Projection générique consommée par la liste partagée RailCityList.
   *
   * Badge ville = le seul compte APRÈS filtres (owner 2026-11-09 : « afficher
   * 1 et pas 1/6 — le 6 ne correspond à rien »). Jamais de format « x/y » :
   * il n'y a qu'un niveau de filtre, donc un seul nombre.
   */
  function toRailItem(
    entry: CityMapEntry,
    key: string,
    unavailable: boolean,
    liveCount: number | null,
    liveSlug: string | null,
  ): RailCityItem {
    const activeCount = countFor(entry, key, unavailable, liveCount, liveSlug);
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
    toRailItem(entry, activeKey, dataUnavailable, selectedCityLiveCount, selectedSlug)
  );

  function handleSelectSlug(slug: string): void {
    const entry = entries.find((e) => e.municipality.slug === slug);
    if (entry) onSelectCity(entry);
  }

  // ── Compteurs globaux (réactifs : référencent activeKey directement) ──────
  function totalFor(
    key: string,
    currentEntries: CityMapEntry[],
    unavailable: boolean,
    liveCount: number | null,
    liveSlug: string | null,
  ): number | null {
    if (unavailable) return null;
    const counts = currentEntries.map((entry) =>
      countFor(entry, key, unavailable, liveCount, liveSlug)
    );
    return counts.some((count) => count === null)
      ? null
      : (counts as number[]).reduce((sum, count) => sum + count, 0);
  }

  $: totalSignals = totalFor(activeKey, entries, dataUnavailable, selectedCityLiveCount, selectedSlug);
  $: citiesWithSignals = totalSignals === null
    ? null
    : entries.filter(
        (e) => (countFor(e, activeKey, dataUnavailable, selectedCityLiveCount, selectedSlug) ?? 0) > 0,
      ).length;
</script>

<svelte:window
  onpointerdown={refreshTimeRangeMax}
  onkeydown={(event) => { refreshTimeRangeMax(event); onClassementWindowKey(event); }}
  on:click={(event) => { onClassementWindowClick(event); onFiltreWindowClick(event); }}
/>

<!-- Le panneau B (checkboxes d'axes + exclusions) est déclaré au NIVEAU RACINE
     (pas dans <RailSection>, sinon Svelte le passerait comme prop) puis rendu
     directement dans la section « Signaux » — plus aucun onglet. -->
{#snippet panelB()}
  <div class="vivier-panel">
    <div class="signals-time-range-picker-wrap">
      <TimeRangePicker
        class="signals-time-range-picker"
        value={timeRange}
        onChange={handleTimeRangePick}
        onOpenChange={handleTimeRangePickerOpen}
        presets={SIGNAL_TIME_RANGE_PRESETS}
        size="sm"
        locale="fr-CA"
        max={timeRangeMax}
        label="Période des signaux"
        formatRange={formatSignalTimeRange}
      >
        {#snippet customExtra()}
          <RadioGroup
            class="signals-date-basis"
            legend="Base de date"
            name="signals-date-basis"
            orientation="horizontal"
            options={DATE_BASIS_ITEMS}
            value={draftDateBasis}
            onchange={selectDraftDateBasis}
          />
        {/snippet}
      </TimeRangePicker>
    </div>
    <div class="classement-filter" bind:this={classementWrapEl}>
      <span class="pertinence-label">Pertinence</span>
      <button
        type="button"
        class="classement-trigger"
        data-testid="classement-filter-trigger"
        aria-expanded={classementOpen}
        aria-haspopup="true"
        on:click|stopPropagation={() => { classementOpen = !classementOpen; if (classementOpen) filtreOpen = false; }}
      >
        <span class="classement-trigger-summary">{classementSummary}</span>
        <span class="classement-trigger-chevron" class:classement-trigger-chevron--open={classementOpen} aria-hidden="true"><ChevronDown size={16} /></span>
      </button>
      {#if classementOpen}
        <div class="classement-panel" data-testid="classement-filter-panel">
          {#each SIGNAL_CLASSES as classe}
            <div class="classement-row">
              <span class="classement-row-check">
                <Checkbox
                  label={CLASSEMENT_META[classe].label}
                  checked={classementFilter[classe]}
                  onchange={(event) => toggleClassement(classe, event.currentTarget.checked)}
                />
              </span>
              <span>
                <Badge tone={classementCounts[classe] > 0 ? "warning" : "neutral"} aria-label="{classementCounts[classe]} signaux">{classementCounts[classe]}</Badge>
              </span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
    <div class="classement-filter" bind:this={filtreWrapEl}>
      <span class="pertinence-label">Filtre</span>
      <button
        type="button"
        class="classement-trigger"
        data-testid="filtre-trigger"
        aria-expanded={filtreOpen}
        aria-haspopup="true"
        on:click|stopPropagation={() => { filtreOpen = !filtreOpen; if (filtreOpen) classementOpen = false; }}
      >
        <span class="classement-trigger-summary">{filtreSummary}</span>
        <span class="classement-trigger-chevron" class:classement-trigger-chevron--open={filtreOpen} aria-hidden="true"><ChevronDown size={16} /></span>
      </button>
      {#if filtreOpen}
        <div class="classement-panel" data-testid="filtre-panel">
          {#each [
            { key: "z", label: FILTRE_LABELS.z, checked: bAxes.z, toggle: (checked: boolean) => toggleBAxis({ z: checked }) },
            { key: "r", label: FILTRE_LABELS.r, checked: bAxes.r, toggle: (checked: boolean) => toggleBAxis({ r: checked }) },
            { key: "p", label: FILTRE_LABELS.p, checked: bAxes.p, toggle: (checked: boolean) => toggleBAxis({ p: checked }) },
            { key: "piia", label: FILTRE_LABELS.piia, checked: exclusions.piiaSansProjetResidentiel, toggle: (checked: boolean) => setExclusion({ piiaSansProjetResidentiel: checked }) },
            { key: "derog", label: FILTRE_LABELS.derog, checked: exclusions.derogationsMineures, toggle: (checked: boolean) => setExclusion({ derogationsMineures: checked }) },
          ] as row}
            <div class="classement-row">
              <span class="classement-row-check">
                <Checkbox
                  label={row.label}
                  checked={row.checked}
                  onchange={(event) => row.toggle(event.currentTarget.checked)}
                />
              </span>
              {#if filtreCounts !== null}
                <span>
                  <Badge tone={filtreCounts[row.key as keyof typeof filtreCounts] > 0 ? "warning" : "neutral"} aria-label="{filtreCounts[row.key as keyof typeof filtreCounts]} signaux">{filtreCounts[row.key as keyof typeof filtreCounts]}</Badge>
                </span>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/snippet}

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

  <!-- ── Section 1 : vue UNIQUE « Nouveau B » (plus de bandeau à onglets) ─── -->
  <RailSection label="Signaux">
    <!-- Le panneau B est rendu DIRECTEMENT : plus de composant Tabs, plus de
         switcher « Référence A / Nouveau B », plus d'en-tête d'onglet. -->
    {@render panelB()}
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
      searchQuery={citySearch}
      onSearchChange={onCitySearchChange}
      onSelect={handleSelectSlug}
    />
  </RailSection>
</RailShell>

<style>
  /* ── Panneau de la vue B ── */
  .vivier-panel {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.25rem 0.75rem 0.25rem;
  }

  /* Keep the native DS trigger a single, compact rail field. The flexible
     label makes the chevron consistently align with the right edge. */
  .vivier-panel :global(.signals-time-range-picker) {
    --st-component-field-labelTypography-size: var(--rail-fs-small, 0.75rem);
    width: 100%;
  }

  .signals-time-range-picker-wrap {
    width: 100%;
  }

  /* The DS panel has a 20rem min-width but MenuPopover caps at 18rem: let the
     in-place overlay take the panel width instead of a horizontal scrollbar
     (same sizing the former portal set inline). */
  .signals-time-range-picker-wrap :global(.st-timeRangePicker__popover) {
    max-width: none;
    overflow-x: hidden;
  }

  .vivier-panel :global(.signals-time-range-picker .st-timeRangePicker__trigger) {
    width: 100%;
  }

  .vivier-panel :global(.signals-time-range-picker .st-timeRangePicker__triggerLabel) {
    flex: 1 1 auto;
    min-width: 0;
    text-align: left;
  }

  /* Typographie compacte des aides/descriptions des checkbox du rail. */
  .vivier-panel :global(.st-choice__help),
  .vivier-panel :global(.st-choice__description) {
    font-size: var(--rail-fs-small, 0.75rem);
  }

  /* Pertinence: label styled like the DS « Période des signaux » field label
     (sentence case, not an uppercase section header). */
  .classement-filter {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .pertinence-label {
    color: var(--st-component-field-labelText, var(--st-semantic-text-primary));
    font-size: var(--rail-fs-small, 0.75rem);
    font-weight: 600;
  }

  .classement-trigger-summary {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .classement-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .classement-row-check {
    flex: 1 1 auto;
    min-width: 0;
  }

  .classement-row :global(.st-badge) {
    flex-shrink: 0;
  }

  .classement-trigger {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    width: 100%;
    padding: 0.35rem 0.5rem;
    border: 1px solid var(--st-semantic-border-subtle);
    border-radius: var(--st-radius-sm, 4px);
    background: var(--st-semantic-surface-default);
    color: var(--st-semantic-text-primary);
    font-size: var(--rail-fs-small, 0.75rem);
    cursor: pointer;
    text-align: left;
  }

  .classement-trigger:hover {
    background: var(--st-semantic-surface-subtle);
  }

  .classement-trigger-chevron {
    flex-shrink: 0;
    color: var(--st-semantic-text-muted);
    transition: transform 0.12s ease;
  }

  .classement-trigger-chevron--open {
    transform: rotate(180deg);
  }

  .classement-panel {
    position: absolute;
    top: calc(100% + 2px);
    left: 0;
    right: 0;
    z-index: 40;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.5rem;
    background: var(--st-semantic-surface-default);
    border: 1px solid var(--st-semantic-border-subtle);
    border-radius: var(--st-component-dropdown-radius, var(--st-radius-md, 0.375rem));
    box-shadow: var(--st-component-dropdown-shadow, var(--st-shadow-medium));
  }

  .classement-panel :global(.st-choice) {
    --st-component-selection-choiceLabelFontSize: var(--rail-fs-small, 0.75rem);
  }
</style>
