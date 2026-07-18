<script lang="ts">
  /**
   * SignauxRail — bande latérale gauche de la vue Signaux.
   *
   * Composé sur les briques de rail PARTAGÉES (RailShell / RailSection /
   * RailCityList — mutualisées avec la vue Sources/Couverture) :
   *   1. Section « Signaux » : deux TABS DS (Vivier A / Vivier B).
   *      - Vivier A : trois axes COMBINABLES (Zonage · Multifamilial 4+ ·
   *        Précoce), tous cochés par défaut → clé `z|m|p`. Décocher recompose
   *        la clé et lit `subsetCounts[clé]` (mécanisme d'avant #376).
   *      - Vivier B : le vivier v2 (zonage ∩ résidentiel), avec un axe Précoce
   *        décoché par défaut + deux exclusions d'affichage.
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
   * Vague 1 DS (0.34.47+) : Tabs · Checkbox (desc+trailing) · Badge tonal ·
   * StatusDot (tone) · Search fluid · Divider
   * ZÉRO couleur hex en dur · ZÉRO override composant DS · ZÉRO icône lucide
   * ZÉRO checkbox/tabs/search bespoke.
   */
  import { Checkbox, Tabs } from "@sentropic/design-system-svelte";
  import type { TabItem } from "@sentropic/design-system-svelte";
  import {
    aFlagsFromKey,
    bAxesFromVivierKey,
    countForVivierCity,
    DEFAULT_A_FLAGS,
    DEFAULT_B_AXES,
    keyForVivierB,
    keyFromAFlags,
    modeFromSubsetKey,
    type AFlags,
    type BAxes,
    type VivierViewMode,
  } from "$lib/signals/vivier-view-mode.js";
  import {
    DEFAULT_VIVIER_B_EXCLUSIONS,
    type VivierBExclusions,
  } from "$lib/signals/vivier-b-display-filter.js";
  import {
    defaultDateRange,
    type SignalDateRange,
  } from "$lib/signals/signal-date-filter.js";
  import DateRangeFilter from "$lib/components/maps/DateRangeFilter.svelte";
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

  /**
   * Clé de MODE initiale (z|m|p ou vivier-v2), restaurée depuis l'URL au
   * rechargement. Elle ne change QUE sur un changement de tab (ou une
   * navigation externe) — jamais sur une simple recomposition d'axes : c'est
   * ce qui permet à la sous-sélection LIVE de survivre au sein d'un tab.
   */
  export let initialSubsetKey = "z|m|p";

  /** Exclusions d'affichage de la vue B (cochées par défaut, décochables). */
  export let exclusions: VivierBExclusions = { ...DEFAULT_VIVIER_B_EXCLUSIONS };

  /**
   * Plage de dates ACTIVE (défaut : 6 derniers mois). Portée par le parent (elle
   * pilote la population de base de la carte + du détail) et rendue À
   * L'IDENTIQUE dans les deux panneaux A/B pour garantir la parité.
   */
  export let dateRange: SignalDateRange = defaultDateRange();

  /**
   * m1.7 — Compte LIVE de `selectedSlug`, calculé par le parent sur les mêmes
   * nœuds détail que le panneau droit (`filteredDetailNodes.length` : axes +
   * exclusions B + plage de dates). `null` tant que ce compte n'est pas
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
  /** Appelé quand la plage de dates change (preset ou plage custom). */
  export let onDateRangeChange: (next: SignalDateRange) => void = () => {};

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

  // ── État LIVE des tabs (owned by the rail) ────────────────────────────────
  // Le tab + la sous-sélection vivent ICI. Le parent renvoie la clé LIVE
  // composée via `initialSubsetKey` : on en DÉRIVE l'état (idempotent — renvoyer
  // `z|p` re-produit exactement les mêmes axes, donc pas de boucle). Quand le
  // parent COLLAPSE la clé (navigation/reload → défaut du tab), rail et carte
  // restent synchrones : les deux repartent du même défaut (A = z|m|p).
  function aFlagsFor(key: string): AFlags {
    return modeFromSubsetKey(key) === "a" ? aFlagsFromKey(key) : { ...DEFAULT_A_FLAGS };
  }
  function bAxesFor(key: string): BAxes {
    return modeFromSubsetKey(key) === "b" ? bAxesFromVivierKey(key) : { ...DEFAULT_B_AXES };
  }
  let activeMode: VivierViewMode = modeFromSubsetKey(initialSubsetKey);
  let aFlags: AFlags = aFlagsFor(initialSubsetKey);
  let bAxes: BAxes = bAxesFor(initialSubsetKey);
  let lastInitialKey = initialSubsetKey;
  $: if (initialSubsetKey !== lastInitialKey) {
    lastInitialKey = initialSubsetKey;
    activeMode = modeFromSubsetKey(initialSubsetKey);
    aFlags = aFlagsFor(initialSubsetKey);
    bAxes = bAxesFor(initialSubsetKey);
  }

  /** Clé LIVE composée : axes de A ou axes de B (zonage/résidentiel/précoce). */
  $: activeKey =
    activeMode === "b" ? keyForVivierB(bAxes) : keyFromAFlags(aFlags);

  /**
   * Change de tab : réinitialise la sous-sélection au défaut du nouveau tab.
   * Le param est `string | Event` pour satisfaire le typage de `Tabs.onchange`
   * (qui s'intersecte avec l'attribut HTML `onchange`) ; Tabs passe la valeur
   * du tab (chaîne), le repli défensif reste A.
   */
  function selectMode(value: string | Event): void {
    const next: VivierViewMode = value === "b" ? "b" : "a";
    activeMode = next;
    aFlags = { ...DEFAULT_A_FLAGS };
    bAxes = { ...DEFAULT_B_AXES };
    onFilterChange(
      next === "b" ? keyForVivierB(DEFAULT_B_AXES) : keyFromAFlags(DEFAULT_A_FLAGS),
    );
  }

  /** Coche/décoche un axe de A : recompose la clé et propage. */
  function toggleAFlag(patch: Partial<AFlags>): void {
    aFlags = { ...aFlags, ...patch };
    onFilterChange(keyFromAFlags(aFlags));
  }

  /** Coche/décoche un axe de B (zonage/résidentiel/précoce) : recompose et propage. */
  function toggleBAxis(patch: Partial<BAxes>): void {
    bAxes = { ...bAxes, ...patch };
    onFilterChange(keyForVivierB(bAxes));
  }

  const TAB_LABELS: Record<VivierViewMode, string> = {
    a: "Référence A",
    b: "Nouveau B",
  };

  // ── Compteur actif par ville = compte bulk de la clé LIVE ──────────────────
  /**
   * Helper non-réactif : compte d'une ville pour la clé LIVE donnée.
   *
   * Pour toute ville AUTRE que `selectedSlug`, le compte reste le bulk serveur :
   * sélectionner une ville ne doit jamais faire varier (ni suspendre) le compte
   * d'une AUTRE ville. Seul un échec de chargement (`unavailable`) rend le
   * compte inconnu → `null` → badge « n/d ».
   *
   * m1.7 — Pour la ville SÉLECTIONNÉE, quand `liveCount` est disponible (le
   * parent l'a calculé sur les mêmes nœuds détail que le panneau droit : axes
   * + exclusions B + plage de dates), on l'utilise à la place du bulk : c'est
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

  // ── Liste de villes (la recherche + le plafond vivent dans RailCityList) ──
  // #5 — garder la ville sélectionnée même si son compte pour le filtre actif
  // est 0 (elle reste visible/désélectionnable dans le rail).
  $: sortedEntries = entries
    .filter((e) => {
      const isSelected =
        selectedSlug !== null && e.municipality.slug === selectedSlug;
      return (
        (countFor(e, activeKey, dataUnavailable, selectedCityLiveCount, selectedSlug) ?? 0) > 0 ||
        isSelected
      );
    })
    .sort((a, b) =>
      (countFor(b, activeKey, dataUnavailable, selectedCityLiveCount, selectedSlug) ?? -1) -
      (countFor(a, activeKey, dataUnavailable, selectedCityLiveCount, selectedSlug) ?? -1)
    );

  /** Projection générique consommée par la liste partagée RailCityList. */
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

<!-- Panneaux de tab déclarés au NIVEAU RACINE (pas dans <RailSection>, sinon
     Svelte les passerait comme props de RailSection) puis rendus par Tabs. -->
{#snippet panelA()}
  <div class="vivier-panel">
    <!-- m2 — PREMIER contrôle : plage de dates (population de base), au-dessus
         de la ligne des axes. Miroir identique dans le panneau B. -->
    <DateRangeFilter value={dateRange} onChange={onDateRangeChange} />
    <div class="vivier-toggles">
      <Checkbox
        label="Zonage"
        checked={aFlags.z}
        onchange={(event) => toggleAFlag({ z: event.currentTarget.checked })}
      />
      <Checkbox
        label="Multifamilial 4+"
        checked={aFlags.m}
        onchange={(event) => toggleAFlag({ m: event.currentTarget.checked })}
      />
      <Checkbox
        label="Précoce"
        checked={aFlags.p}
        onchange={(event) => toggleAFlag({ p: event.currentTarget.checked })}
      />
    </div>
  </div>
{/snippet}

{#snippet panelB()}
  <div class="vivier-panel">
    <!-- m2 — Miroir À L'IDENTIQUE du filtre de plage de dates du panneau A
         (parité A/B) : premier contrôle, au-dessus des axes. -->
    <DateRangeFilter value={dateRange} onChange={onDateRangeChange} />
    <div class="vivier-toggles">
      <!-- Trois axes COMBINABLES, librement cochables/décochables (défauts
           Zonage ✓, Résidentiel ✓, Précoce ✗). Décocher un axe RELÂCHE le filtre
           d'affichage (lecture de la classification serveur, jamais une
           reclassification). -->
      <Checkbox
        label="Zonage"
        checked={bAxes.z}
        onchange={(event) => toggleBAxis({ z: event.currentTarget.checked })}
      />
      <Checkbox
        label="Résidentiel"
        checked={bAxes.r}
        onchange={(event) => toggleBAxis({ r: event.currentTarget.checked })}
      />
      <Checkbox
        label="Précoce"
        checked={bAxes.p}
        onchange={(event) => toggleBAxis({ p: event.currentTarget.checked })}
      />
    </div>

    <div class="vivier-b-exclusions">
      <Checkbox
        label="Exclure PIIA sans projet résidentiel"
        checked={exclusions.piiaSansProjetResidentiel}
        onchange={(event) =>
          setExclusion({ piiaSansProjetResidentiel: event.currentTarget.checked })}
      />
      <Checkbox
        label="Exclure dérogations mineures"
        checked={exclusions.derogationsMineures}
        onchange={(event) =>
          setExclusion({ derogationsMineures: event.currentTarget.checked })}
      />
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

  <!-- ── Section 1 : tabs Vivier A / Vivier B ────────────────────────────── -->
  <RailSection label="Signaux">
    <!-- Le panneau riche (checkboxes, compteurs) est rendu PAR le composant DS
         Tabs via un snippet ; on ne réimplémente ni les onglets ni le panneau.
         `{#key activeMode}` re-monte Tabs quand le TAB change (clic ou nav
         externe) pour resynchroniser l'onglet actif — mais PAS sur une simple
         recomposition d'axes (le mode ne change pas), qui garderait le focus. -->
    <!-- Le wrapper porte les tokens DS de taille des onglets : ils cascadent
         par variable CSS dans le composant Tabs (scoped, aucun override
         d'interne). -->
    <div class="vivier-tabs-wrap">
      {#key activeMode}
        <Tabs
          label="Vivier"
          activeValue={activeMode}
          onchange={selectMode}
          items={[
            { value: "a", label: TAB_LABELS.a, content: panelA },
            { value: "b", label: TAB_LABELS.b, content: panelB },
          ]}
        />
      {/key}
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
  /* ── Onglets vivier : taille STANDARD compacte du rail. Les tokens DS posés
     sur le wrapper cascadent (variables CSS) dans le composant Tabs — zéro
     override d'interne. Sans ça, les onglets héritent d'une fonte trop grande. ── */
  .vivier-tabs-wrap {
    --st-component-tabs-tabFontSize: var(--rail-fs-small, 0.8125rem);
    --st-component-tabs-tabPaddingBlock: 0.5rem;
    --st-component-tabs-tabPaddingInline: 0.25rem;
  }

  /* ── Panneau d'un tab vivier ── */
  .vivier-panel {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.25rem 0.75rem 0.25rem;
  }

  .vivier-toggles {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .vivier-toggles :global(.st-choice) {
    --st-component-selection-choiceLabelFontSize: var(--rail-fs-small, 0.75rem);
  }

  /* Typographie compacte des aides/descriptions des checkbox du rail. */
  .vivier-panel :global(.st-choice__help),
  .vivier-panel :global(.st-choice__description) {
    font-size: var(--rail-fs-small, 0.75rem);
  }

  /* ── Exclusions d'affichage de B ── */
  .vivier-b-exclusions {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .vivier-b-exclusions :global(.st-choice) {
    --st-component-selection-choiceLabelFontSize: var(--rail-fs-small, 0.75rem);
  }
</style>
