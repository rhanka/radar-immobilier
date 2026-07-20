<script lang="ts">
  /**
   * SignauxSelPanel — right selection bucket for the Signaux map.
   *
   * The left rail keeps navigation light (cities list + signal facets); this
   * panel owns the SELECTION context: active city header + detailed cards for
   * graph signals, zones and lots.
   *
   * Filtres DONNÉES (remplacent le bloc autonome « Filtre Zones et Lots » du
   * rail gauche, supprimé) : chaque accordéon porte SON en-tête de filtre
   * au-dessus de sa liste —
   *   - LOTS : filtres lot existants (`eval-lot-filters`, réutilisés) —
   *     catégorie exclusive + usages additifs + superficie min ;
   *   - ZONES : filtre par TYPE de zone (`zone-kind-filter`, catégories de la
   *     légende zonage) en chips additives.
   * L'état des filtres vit dans le PARENT (il pilote la peinture carte, zéro
   * refetch) : fermer un accordéon masque son en-tête (details natif) mais NE
   * réinitialise PAS son filtre — le compteur « N/M » du bandeau d'accordéon
   * reste affiché pour signaler un filtre actif.
   */
  import { tick } from "svelte";
  import { Alert, Badge } from "@sentropic/design-system-svelte";
  import { FileText, FileX, RefreshCw, X } from "@lucide/svelte";
  import type { CityMapEntry } from "$lib/maps/maps-data.js";
  import {
    extractDocRefs,
    extractSignalEvidence,
    type GraphSignalNode,
    type SignalDocRef,
    type SignalEvidence,
  } from "$lib/signals/graph-signal-detail-client.js";
  import { nodeMatchesSubset } from "$lib/signals/graph-signal-filter.js";
  import {
    isPiiaLie,
    PIIA_LIE_BADGE,
  } from "$lib/signals/vivier-b-display-filter.js";
  import {
    isEffetDensifiantUnknown,
    vivierEffetDensifiantLabel,
    vivierRankReasonLabel,
  } from "$lib/signals/vivier-b-ranking.js";
  import { signalColorAt } from "$lib/signals/pdf-signal-colors.js";
  import type {
    GeoZoneFeature,
    GeoZonesResponse,
  } from "$lib/maps/geo-zones-client.js";
  import type {
    LotFeature,
    LotsResponse,
  } from "$lib/maps/lots-client.js";
  import {
    createSelectionBucketState,
    makeKey,
    parseKey,
    selectionVisualState,
    type SelectionBucketState,
    type SelectionKey,
  } from "$lib/maps/selection-bucket.js";
  import {
    extractSignalLotRefs,
    extractSignalZoneRefs,
    mergeDesignatedZones,
    zoneRefComparableKey,
  } from "$lib/maps/signaux-map-geo.js";
  import {
    evaluatedLotScore,
    facadeDisplay,
    formatArea,
    formatPostalCode,
    formatYesNo,
    lotNormesRows,
    lotZoneCode,
    usageDominantDisplay,
  } from "$lib/components/maps/lot-fiche-utils.js";
  import {
    zoneKindStyle,
    ZONE_KIND_NEUTRAL,
  } from "$lib/maps/zone-kind-style.js";
  import {
    DEFAULT_EVAL_FILTER,
    isDefaultEvalFilter,
    lotMatchesEvalFilter,
    type EvalLotFilter,
  } from "$lib/maps/eval-lot-filters.js";
  import {
    DEFAULT_ZONE_KIND_FILTER,
    isDefaultZoneKindFilter,
    zoneMatchesKindFilter,
    type ZoneKindFilter,
  } from "$lib/maps/zone-kind-filter.js";
  import {
    DEFAULT_ZONE_MILLESIME_FILTER,
    isDefaultZoneMillesimeFilter,
    zoneMatchesMillesime,
    type ZoneMillesimeFilter,
  } from "$lib/maps/zone-millesime-filter.js";
  import LotFilterHeader from "$lib/components/maps/LotFilterHeader.svelte";
  import ZoneFilterHeader from "$lib/components/maps/ZoneFilterHeader.svelte";
  import {
    aggregateReglements,
    type ReglementEntry,
  } from "$lib/maps/signaux-reglements.js";
  import { describeZoneSource } from "$lib/maps/zone-source.js";

  export let selectedCity: CityMapEntry | null = null;
  export let detailNodes: GraphSignalNode[] = [];
  /**
   * Nombre de signaux de la ville AVANT les lentilles d'affichage client
   * (plage de dates, exclusions B) : `detailNodes` arrive DÉJÀ filtré du
   * parent. Permet de distinguer « ville sans signal indexé » (0 partout) de
   * « aucun signal dans la plage sélectionnée » (des signaux existent, tous
   * masqués par la plage de dates / les filtres).
   */
  export let unfilteredSignalCount = 0;
  export let detailLoading = false;
  export let detailError: string | null = null;
  // Waiters PAR COUCHE : zones et lots ont chacun leur propre état
  // chargement/erreur (découplés — l'échec de l'un n'affecte pas l'autre).
  export let zonesLoading = false;
  export let zonesError: string | null = null;
  export let lotsLoading = false;
  export let lotsError: string | null = null;
  export let zonesResponse: GeoZonesResponse | null = null;
  export let lotsResponse: LotsResponse | null = null;
  export let selectionState: SelectionBucketState = createSelectionBucketState();
  /** #3 — Clé de filtre active (ex. "z", "z|m", "") propagée depuis SignauxMapView. */
  export let activeSubsetKey = "";
  /**
   * Vue B (vivier v2) active : la liste des signaux est TRIÉE par le comparateur
   * déterministe du domaine (côté parent), et chaque fiche porte sa RAISON de
   * rang + le statut d'effet densifiant. En A, aucun de ces éléments n'est rendu.
   */
  export let vivierBMode = false;
  // ── Filtres DONNÉES par accordéon (état PORTÉ PAR LE PARENT : il pilote la
  // peinture carte — zéro refetch ; il persiste quand l'accordéon se ferme). ──
  /** Filtre lots (catégorie/usages/superficie) — en-tête de l'accordéon Lots. */
  export let lotFilter: EvalLotFilter = DEFAULT_EVAL_FILTER;
  export let onLotFilterChange: (filter: EvalLotFilter) => void = () => {};
  /** Filtre par TYPE de zone (kind) — en-tête de l'accordéon Zones. */
  export let zoneKindFilter: ZoneKindFilter = DEFAULT_ZONE_KIND_FILTER;
  export let onZoneKindFilterChange: (filter: ZoneKindFilter) => void = () => {};
  // Filtre par MILLÉSIME de zonage (exclusif) — même état partagé que la carte.
  export let zoneMillesimeFilter: ZoneMillesimeFilter = DEFAULT_ZONE_MILLESIME_FILTER;
  export let onZoneMillesimeFilterChange: (filter: ZoneMillesimeFilter) => void =
    () => {};
  export let onClear: () => void = () => {};
  export let onToggleKey: (key: SelectionKey) => void = () => {};
  /** « Réessayer » — recharge le détail signaux (couche panneau droit). */
  export let onRetryDetail: () => void = () => {};
  /** « Réessayer » — recharge les couches géo (zones + lots). */
  export let onRetryGeo: () => void = () => {};
  // onFocusKey retiré (#9) : SignauxSelPanel n'appelle plus directement le focus ;
  // c'est toggleBucketKey dans le parent qui gère focus + sélection atomiquement.
  export let onOpenDocument: (ref: SignalDocRef) => void = () => {};
  export let onOpenEvidence: (payload: {
    title: string;
    evidence: SignalEvidence;
    node: GraphSignalNode;
  }) => void = () => {};
  /**
   * m7 / m8 — ouvre une SOURCE documentaire générique (règlement PDF, grille de
   * zonage PDF, source de zone) dans le viewer partagé. Le viewer décide seul
   * PDF vs iframe selon l'URL (looksLikePdf). `rawRef` (interne, same-origin)
   * est préféré pour un rendu PDF quand il est disponible.
   */
  export let onOpenSource: (payload: {
    title: string;
    sourceUrl: string | null;
    rawRef?: string | null;
    page?: number | null;
  }) => void = () => {};
  /**
   * #86 — cross-highlight signal ↔ fiche. `hoveredSignalId` est l'id du signal
   * survolé DANS LE VIEWER PDF : la fiche correspondante ici prend un état
   * sélectionné + scrolle en vue. `onHoverSignal` notifie le parent quand une
   * fiche est survolée à droite (→ le surlignage PDF pulse). Bidirectionnel.
   */
  export let hoveredSignalId: string | null = null;
  export let onHoverSignal: (id: string | null) => void = () => {};

  // Conteneur scrollable des fiches (pour amener en vue la fiche cross-survolée).
  let entityListEl: HTMLDivElement | null = null;

  // #86 — quand le viewer survole un badge, scrolle la fiche correspondante en
  // vue (sans la focaliser : on n'ouvre pas le détail, on signale juste). Le
  // surlignage visuel se fait via la classe sel-entity-head--xhover.
  $: void scrollHoveredFicheIntoView(hoveredSignalId);
  async function scrollHoveredFicheIntoView(id: string | null): Promise<void> {
    if (!id || !entityListEl) return;
    await tick();
    const el = entityListEl.querySelector<HTMLElement>(
      `[data-signal-node="${cssAttrEscape(id)}"]`,
    );
    if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  function cssAttrEscape(value: string): string {
    return value.replace(/["\\]/g, "\\$&");
  }

  /** #3 — Nœuds filtrés selon la clé de filtre active. */
  $: filteredDetailNodes = activeSubsetKey
    ? detailNodes.filter((n) => nodeMatchesSubset(n, activeSubsetKey))
    : detailNodes;

  /** Compteurs filtré/total pour les badges signaux. */
  $: filteredSignalCount = filteredDetailNodes.length;
  $: totalSignalCount = detailNodes.length;
  /** True si le filtre actif réduit le nombre de signaux. */
  $: signalIsFiltered = activeSubsetKey && filteredSignalCount < totalSignalCount;

  /** Slug de la ville courante (pour les features de zones désignées sans géo). */
  $: activeCitySlug =
    selectedCity?.municipality.slug ??
    zonesResponse?.citySlug ??
    detailNodes.find((n) => n.citySlug)?.citySlug ??
    "";

  /**
   * Zones affichées = zones géo de l'API + zones DÉSIGNÉES par les signaux
   * mais absentes de la couche cadastrale (ex. rezonage futur "A16"/"I93").
   * Une zone désignée sans polygone est listée (badge « géométrie geo
   * manquante ») au lieu d'être masquée : le polygone ne sert qu'à la carte.
   *
   * DÉDUP par code : les collections réelles portent des codes dupliqués
   * (polygones disjoints d'une même zone réglementaire, ex. Salaberry
   * C-186 ×2) — une seule fiche par zone, la carte rend tous les polygones.
   */
  $: zones = dedupeZonesByCode(
    mergeDesignatedZones(
      zonesResponse?.featureCollection.features ?? [],
      detailNodes,
      activeCitySlug,
    ),
  );
  $: lots = lotsResponse?.featureCollection.features ?? [];

  /**
   * m7 — Règlements de la ville, dérivés des SIGNAUX affichés (numéro cité +
   * zones référencées + preuve documentaire) et des grilles PDF des zones
   * liées. Aucun endpoint dédié ne sert une liste de règlements par ville (cf.
   * note PR) : on ne fabrique rien, on agrège ce qui est déjà servi.
   */
  $: reglements = aggregateReglements(filteredDetailNodes, zones);

  function dedupeZonesByCode(zoneFeatures: GeoZoneFeature[]): GeoZoneFeature[] {
    const seen = new Set<string>();
    const out: GeoZoneFeature[] = [];
    for (const zone of zoneFeatures) {
      const key = `${zone.properties.citySlug}/${zone.properties.code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(zone);
    }
    return out;
  }

  // ── #4 — Filtrage zones/lots selon filtre actif ────────────────────────────
  /**
   * Clés comparables (tiret ignoré) des zones référencées par au moins un
   * signal filtré. La clé comparable réconcilie "A16" (signal) et "A-16" (zone).
   */
  $: filteredZoneCodeSet = (() => {
    if (!activeSubsetKey || filteredDetailNodes.length === 0) return null;
    const keys = new Set<string>();
    for (const node of filteredDetailNodes) {
      for (const code of extractSignalZoneRefs(node)) {
        keys.add(zoneRefComparableKey(code));
      }
    }
    return keys.size > 0 ? keys : null;
  })();

  /** Numéros de lots référencés par au moins un signal filtré. */
  $: filteredLotNoSet = (() => {
    if (!activeSubsetKey || filteredDetailNodes.length === 0) return null;
    const noLots = new Set<string>();
    for (const node of filteredDetailNodes) {
      for (const ref of extractSignalLotRefs(node)) {
        noLots.add(ref);
      }
    }
    return noLots.size > 0 ? noLots : null;
  })();

  /** Zones liées aux signaux filtrés (si filtre signaux actif et résultats). */
  $: subsetFilteredZones = filteredZoneCodeSet
    ? zones.filter((z) => filteredZoneCodeSet!.has(zoneRefComparableKey(z.properties.code)))
    : zones;

  // ── Filtre par MILLÉSIME de zonage (exclusif) — EN AMONT du filtre type ────
  // Le millésime restreint la couche AVANT le type : la liste, les chips de type
  // et leurs comptes reflètent le millésime retenu (miroir strict de la carte).
  $: zoneMillesimeFilterActive = !isDefaultZoneMillesimeFilter(zoneMillesimeFilter);
  /** Couche entière restreinte au millésime retenu (base des chips de type). */
  $: layerMillesimeZones = zoneMillesimeFilterActive
    ? zones.filter((z) =>
        zoneMatchesMillesime(z.properties.reglementMillesime ?? null, zoneMillesimeFilter),
      )
    : zones;
  /** Liste (filtre signaux) restreinte au millésime retenu. */
  $: subsetMillesimeZones = zoneMillesimeFilterActive
    ? subsetFilteredZones.filter((z) =>
        zoneMatchesMillesime(z.properties.reglementMillesime ?? null, zoneMillesimeFilter),
      )
    : subsetFilteredZones;

  // ── Filtre par TYPE de zone (en-tête de l'accordéon Zones) ────────────────
  $: zoneKindFilterActive = !isDefaultZoneKindFilter(zoneKindFilter);
  /** Zones listées = filtre signaux ∩ millésime ∩ type. */
  $: filteredZones = zoneKindFilterActive
    ? subsetMillesimeZones.filter((z) =>
        zoneMatchesKindFilter(
          z.properties.kind ?? null,
          z.properties.code,
          zoneKindFilter,
          z.properties.affectation ?? null,
        ),
      )
    : subsetMillesimeZones;
  /**
   * Entrée (kind/code) de l'en-tête de filtre — base = toutes les zones de la
   * ville RESTREINTES au millésime retenu (pas la liste réduite par le filtre
   * signaux) : le filtre TYPE pilote la peinture de TOUTE la couche carte, ses
   * chips et son compteur N/M doivent donc refléter la couche du millésime.
   */
  $: zoneFilterInput = layerMillesimeZones.map((z) => ({
    kind: z.properties.kind ?? null,
    code: z.properties.code,
    affectation: z.properties.affectation ?? null,
  }));
  /**
   * Base du sélecteur de millésime = TOUTES les zones de la ville (jamais la
   * couche déjà filtrée par millésime, sinon le sélecteur se masquerait après un
   * choix). Le sélecteur reste masqué tant qu'il n'y a pas ≥ 2 millésimes servis.
   */
  $: zoneMillesimeInput = zones.map((z) => ({
    reglementMillesime: z.properties.reglementMillesime ?? null,
  }));

  /** Lots filtrés : uniquement ceux liés aux signaux filtrés (si filtre actif et résultats). */
  $: filteredLots = filteredLotNoSet ? lots.filter((l) => filteredLotNoSet!.has(l.properties.noLot)) : lots;

  // ── Filtre LOTS (en-tête de l'accordéon Lots — eval-lot-filters réutilisé) ─
  $: lotFilterActive = !isDefaultEvalFilter(lotFilter);
  /** Lots listés = filtre signaux ∩ filtre lots. */
  $: evalFilteredLots = lotFilterActive
    ? filteredLots.filter((l) => lotMatchesEvalFilter(l.properties, lotFilter))
    : filteredLots;
  /**
   * Compteur N/M de l'en-tête + bandeau : base = TOUS les lots chargés (comme
   * l'ex-panneau autonome), car le filtre peint TOUTE la couche carte — pas
   * seulement la liste réduite par le filtre signaux (miroir carte).
   */
  $: lotMatchedCount = lotFilterActive
    ? lots.filter((l) => lotMatchesEvalFilter(l.properties, lotFilter)).length
    : lots.length;

  // Total = zones réellement affichables (couche cadastrale + zones désignées
  // par les signaux), pas seulement le zoneCount de la couche géo.
  $: configuredZoneCount = zones.length;
  /** true si un filtre RESTREINT la liste des zones (signaux, type ou millésime). */
  $: zoneListFiltered =
    Boolean(filteredZoneCodeSet) || zoneKindFilterActive || zoneMillesimeFilterActive;
  /** Nombre de zones visibles selon les filtres actifs (signaux, type et/ou millésime). */
  $: visibleZoneCount = zoneListFiltered ? filteredZones.length : configuredZoneCount;
  $: zoneBadgeText =
    zonesResponse?.resolutionStatus === "fallback" && configuredZoneCount === 0
      ? "zones non configurées"
      : zoneListFiltered
        ? `${visibleZoneCount}/${configuredZoneCount} zone${configuredZoneCount !== 1 ? "s" : ""}`
        : `${configuredZoneCount} zone${configuredZoneCount !== 1 ? "s" : ""}`;
  /** C4 — n° du lot focusé (fiche ouverte), pour l'inclure dans la liste capée. */
  $: focusedLotNo = (() => {
    const key = selectionState.focusedKey;
    if (!key) return null;
    const parsed = parseKey(key);
    if (!parsed || parsed.kind !== "lot") return null;
    const sep = parsed.id.indexOf("/");
    return sep > 0 && sep < parsed.id.length - 1 ? parsed.id.slice(sep + 1) : null;
  })();
  // Cap DOM à 80 fiches, mais le lot FOCUSÉ (clic carte, C4) est TOUJOURS
  // rendu : s'il dépasse le cap OU s'il est écarté par le filtre lots (clic
  // sur un lot estompé de la carte), il est remonté en tête de liste — la
  // sélection carte → fiche n'est jamais cassée par un filtre.
  $: visibleLots = ensureFocusedLotVisible(evalFilteredLots, focusedLotNo, filteredLots);

  function ensureFocusedLotVisible(
    shown: LotFeature[],
    noLot: string | null,
    lookup: LotFeature[] = shown,
  ): LotFeature[] {
    const capped = shown.slice(0, 80);
    if (!noLot || capped.some((lot) => lot.properties.noLot === noLot)) {
      return capped;
    }
    const focused = lookup.find((lot) => lot.properties.noLot === noLot);
    return focused ? [focused, ...capped] : capped;
  }

  // Même contrat pour les ZONES : la zone focusée (clic carte / badge lot)
  // reste listée même si le filtre par type l'écarte.
  $: focusedZoneCode = (() => {
    const key = selectionState.focusedKey;
    if (!key) return null;
    const parsed = parseKey(key);
    if (!parsed || parsed.kind !== "zone") return null;
    const sep = parsed.id.indexOf("/");
    return sep > 0 && sep < parsed.id.length - 1 ? parsed.id.slice(sep + 1) : null;
  })();
  $: visibleZones = ensureFocusedZoneVisible(filteredZones, focusedZoneCode, subsetFilteredZones);

  function ensureFocusedZoneVisible(
    shown: GeoZoneFeature[],
    code: string | null,
    lookup: GeoZoneFeature[],
  ): GeoZoneFeature[] {
    if (!code || shown.some((zone) => zone.properties.code === code)) return shown;
    const focused = lookup.find((zone) => zone.properties.code === code);
    return focused ? [focused, ...shown] : shown;
  }
  $: zonesUnavailableReason =
    zonesResponse?.warnings.includes("geo-collection-not-configured")
      ? "Zones non configurées dans l'API geo."
      : null;
  $: lotTotalCount = filteredLotNoSet ? filteredLots.length : (lotsResponse?.numberMatched ?? lots.length);
  /** Total de la LISTE affichée (filtre lots appliqué) — base du cap DOM 80. */
  $: lotListTotal = lotFilterActive ? evalFilteredLots.length : lotTotalCount;
  $: hiddenLotCount = Math.max(0, lotListTotal - visibleLots.length);
  $: lotsUnavailableReason =
    lotsResponse && !lotsResponse.ok
      ? lotsResponse.reason ?? "Lots non configurés dans l'API geo."
      : null;

  function safeKey(kind: "municipality" | "signal" | "zone" | "lot", id: string): SelectionKey | null {
    try {
      return makeKey(kind, id);
    } catch {
      return null;
    }
  }

  function signalKey(node: GraphSignalNode): SelectionKey | null {
    return safeKey("signal", node.id);
  }

  function zoneKey(zone: GeoZoneFeature): SelectionKey | null {
    return safeKey("zone", `${zone.properties.citySlug}/${zone.properties.code}`);
  }

  function lotKey(lot: LotFeature): SelectionKey | null {
    const citySlug = lot.properties.citySlug ?? selectedCity?.municipality.slug;
    if (!citySlug) return null;
    return safeKey("lot", `${citySlug}/${lot.properties.noLot}`);
  }

  // `state` is passed explicitly (not read from the closure) so that
  // `selectionState` appears textually in each `{@const … = visual(selectionState, key)}`
  // expression. In Svelte 5 legacy mode, the `{@const}` deriveds inside a keyed
  // `{#each}` only re-run when a reactive value read *directly in the expression*
  // changes. Reading `selectionState` inside the function body alone left the
  // derived stale, so clicking a signal updated the state but never re-rendered
  // its detail card (`{#if nodeVisual.focused}`).
  function visual(state: SelectionBucketState, key: SelectionKey) {
    return selectionVisualState(state, key);
  }

  function toggleEntity(key: SelectionKey): void {
    // #9 — n'appelle PAS onFocusKey séparément : toggleBucketKey dans le parent
    // gère déjà le focus via setFocus après le toggle. Appeler les deux causait
    // un état focus-sans-sélection qui bloquait l'accordéon sur le 1er item.
    onToggleKey(key);
  }

  function formatDate(value: string | null): string | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString("fr-CA");
  }

  function formatDocumentDate(value: string | null): string | null {
    if (!value) return null;
    if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) return value;
    return formatDate(value);
  }

  function readString(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0
      ? value.trim()
      : null;
  }

  function nodeReglement(node: GraphSignalNode): string | null {
    return (
      readString(node.props.reglement_number) ??
      readString(node.props.reglementNumber) ??
      readString(node.props.bylaw) ??
      null
    );
  }

  function nodeZoneRef(node: GraphSignalNode): string | null {
    const value =
      node.props.zone_ref ??
      node.props.zoneRef ??
      node.props.zone ??
      node.props.zones;
    if (Array.isArray(value)) return value.map(String).join(", ");
    return readString(value);
  }

  function docRefs(node: GraphSignalNode): SignalDocRef[] {
    return node.docRefs && node.docRefs.length > 0
      ? node.docRefs
      : extractDocRefs(node.props);
  }

  function signalPublishedAt(node: GraphSignalNode): string | null {
    return node.publishedAt ?? docRefs(node).find((ref) => ref.publishedAt)?.publishedAt ?? null;
  }

  function docButtonLabel(ref: SignalDocRef): string {
    return `PDF${ref.page !== undefined ? ` · p.${ref.page}` : ""}`;
  }

  function docTitle(ref: SignalDocRef): string {
    return ref.title ?? ref.sourceUrl ?? ref.rawRef ?? ref.docSha;
  }

  function formatSignalCount(count: number): string {
    return formatCount(count, "signal", "signaux");
  }

  function formatCount(count: number, singular: string, plural: string): string {
    return `${formatNumber(count)} ${count === 1 ? singular : plural}`;
  }

  function formatNumber(count: number): string {
    return count.toLocaleString("fr-CA");
  }

  function nodeTypeLabel(type: string): string {
    if (type === "DesignationEvent") return "Événement de désignation";
    return type;
  }

  function signalEvidence(node: GraphSignalNode): SignalEvidence {
    return extractSignalEvidence(node);
  }

  function evidenceText(value: string | null, maxLength = 260): string | null {
    if (!value) return null;
    return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
  }

  function formatBbox(value: [number, number, number, number] | null): string | null {
    return value ? value.map((n) => n.toFixed(3)).join(", ") : null;
  }

  function evidenceCompletenessItems(evidence: SignalEvidence): Array<{ label: string; ok: boolean }> {
    return [
      { label: "Description", ok: evidence.completeness.hasDescription },
      { label: "Citation", ok: evidence.completeness.hasCitationExcerpt },
      { label: "PDF/source", ok: evidence.completeness.hasPdfLink },
      { label: "Page", ok: evidence.completeness.hasPage },
      { label: "BBox", ok: evidence.completeness.hasBbox },
    ];
  }

  function hasSourceEvidence(evidence: SignalEvidence): boolean {
    return (
      evidence.documentUrl !== null ||
      evidence.sourceUrl !== null ||
      evidence.rawRef !== null ||
      evidence.rawObjectKey !== null ||
      evidence.sourceRef !== null
    );
  }

  function sourceButtonLabel(evidence: SignalEvidence): string {
    if (evidence.documentUrl || evidence.sourceUrl) return "Voir PDF/source";
    if (hasSourceEvidence(evidence)) return "Voir provenance";
    return "Source manquante";
  }

  function openEvidence(node: GraphSignalNode): void {
    onOpenEvidence({
      title: node.label,
      evidence: signalEvidence(node),
      node,
    });
  }

  /**
   * Nombre de signaux (autres que `node`) pointant le MÊME PV (même rawRef).
   * Sert à signaler dans la fiche que le surlignage de la preuve montrera
   * plusieurs signaux (#84). 0 si rawRef absent ou signal unique.
   */
  function coPvSignalCount(node: GraphSignalNode): number {
    const rawRef = signalEvidence(node).rawRef;
    if (!rawRef) return 0;
    let count = 0;
    for (const other of detailNodes) {
      if (other.id === node.id) continue;
      if (signalEvidence(other).rawRef === rawRef) count += 1;
    }
    return count;
  }

  /**
   * Couleur de la pastille du signal dans la fiche. Quand on ouvre un signal il
   * est le « signal courant » du viewer, donc TOUJOURS de la couleur de rang 0
   * (mise en avant). On répète cette couleur ici pour le lien visuel
   * surlignage ↔ fiche (#84).
   */
  function signalColor(): string {
    return signalColorAt(0);
  }

  function zoneSourceLabel(zone: GeoZoneFeature): string {
    if (zone.properties.source === "official-zone") return "officiel";
    if (zone.properties.source === "signal-designated") return "désignée par signal";
    return "fallback lots";
  }

  function zoneGeometryLabel(zone: GeoZoneFeature): string {
    switch (zone.properties.geometryStatus) {
      case "official":
        return "géométrie officielle";
      case "lot-union-fallback":
        return "union de lots";
      case "text-only":
        return "référence texte";
      case "missing":
        return "géométrie manquante";
    }
  }

  function confidencePct(value: number): string {
    return `${Math.round(value * 100)} %`;
  }

  /**
   * Score de potentiel AFFICHABLE (« x.x/10 ») — null quand le score n'est pas
   * évalué (`potentialScoreStatus: "unavailable"`) : on n'affiche jamais un
   * « 0.0/10 » placeholder comme s'il était mesuré (copy « non évalué »).
   */
  function lotScore(lot: LotFeature): string | null {
    const score = evaluatedLotScore(lot.properties);
    return score !== null ? `${score.toFixed(1)}/10` : null;
  }

  /**
   * Type de zone joint quand il est réellement précisé par la source.
   * « non précisé » / « AUTRE » = placeholders internes → rangée masquée
   * (copy client neutre, pas de jargon).
   */
  function lotZoneKind(lot: LotFeature): string | null {
    const kind = lot.properties.zone?.kind;
    if (!kind) return null;
    const folded = kind.trim().toLowerCase();
    return folded === "non précisé" || folded === "autre" ? null : kind;
  }

  /**
   * Flag 4+ client-facing : « Oui/Non », suffixé de sa source honnête
   * (« grille » = norme extraite ; « heuristique » = dérivation par type de
   * zone) quand l'API l'expose. « — » discret quand absent.
   */
  function lot4Plus(lot: LotFeature): string {
    const flag = lot.properties.multifamilial4plus;
    const text = formatYesNo(flag);
    const source = lot.properties.multifamilial4plusSource;
    return flag !== undefined && source ? `${text} · ${source}` : text;
  }

  // ── Contrat d'interaction zone ↔ lot ↔ signal ─────────────────────────────
  // État d'ouverture des accordéons Zones/Signaux/Lots : les liens croisés
  // (badge zone d'un lot, signal citant une zone) ET la sélection carte (C4)
  // déplient le bucket cible pour que la fiche focusée soit VISIBLE.
  let zonesBucketOpen = false;
  let signalsBucketOpen = false;
  let lotsBucketOpen = false;
  // m7 — accordéon Règlements (entre Signaux et Zones), replié par défaut.
  let reglementsBucketOpen = false;

  // C4 — la sélection carte ouvre la FICHE dans le drawer : quand le focus
  // désigne une zone / un lot / un signal, on déplie son bucket et on scrolle
  // la fiche en vue (détail complet, pas un simple survol).
  let bucketsEl: HTMLDivElement | null = null;
  $: void revealFocusedEntity(selectionState.focusedKey);
  async function revealFocusedEntity(key: SelectionKey | null): Promise<void> {
    if (!key) return;
    const parsed = parseKey(key);
    if (!parsed) return;
    if (parsed.kind === "zone") zonesBucketOpen = true;
    else if (parsed.kind === "lot") lotsBucketOpen = true;
    else if (parsed.kind === "signal") signalsBucketOpen = true;
    else return;
    await tick();
    const el = bucketsEl?.querySelector<HTMLElement>(
      `[data-entity-key="${cssAttrEscape(key)}"]`,
    );
    if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  /**
   * Millésime + n° de règlement de zonage PORTÉ PAR LA ZONE quand geo les sert
   * (ex. « 2008 · règl. 2008-102 »). Contrat anti-invention : rien n'est rendu
   * quand la source ne fournit ni l'un ni l'autre (villes en store-local
   * aujourd'hui — pas de colonne millésime en base, cf. note ask geo). La clé
   * s'adapte : « Millésime » quand l'année est servie, sinon « Règlement ».
   */
  function zoneReglementRow(
    zone: GeoZoneFeature,
  ): { key: string; value: string } | null {
    const millesime = readString(zone.properties.reglementMillesime);
    const numero = readString(zone.properties.reglementNumero);
    if (!millesime && !numero) return null;
    const parts: string[] = [];
    if (millesime) parts.push(millesime);
    if (numero) parts.push(`règl. ${numero}`);
    return { key: millesime ? "Millésime" : "Règlement", value: parts.join(" · ") };
  }

  /** Type (kind) résolu de la zone — null si indéterminé (affiché « — »). */
  function zoneTypeLabel(zone: GeoZoneFeature): string | null {
    const style = zoneKindStyle(
      zone.properties.kind ?? null,
      zone.properties.code,
      zone.properties.affectation ?? null,
    );
    return style === ZONE_KIND_NEUTRAL ? null : style.label;
  }

  /**
   * Nombre de lots joints à la zone : `lotCount` de l'endpoint quand présent,
   * sinon jointure par code (zoneCode des items lots #314). `lotFeatures` est
   * passé EXPLICITEMENT (réactivité des {@const} dans un each keyed).
   */
  function zoneLotCount(zone: GeoZoneFeature, lotFeatures: LotFeature[]): number {
    if (zone.properties.lotCount > 0) return zone.properties.lotCount;
    const key = zoneRefComparableKey(zone.properties.code);
    if (key.length === 0) return 0;
    let count = 0;
    for (const lot of lotFeatures) {
      const code = lotZoneCode(lot.properties);
      if (code && zoneRefComparableKey(code) === key) count += 1;
    }
    return count;
  }

  /** Signaux de la ville citant cette zone (lien signal↔zone existant). */
  function signalsCitingZone(
    zone: GeoZoneFeature,
    nodes: GraphSignalNode[],
  ): GraphSignalNode[] {
    const key = zoneRefComparableKey(zone.properties.code);
    if (key.length === 0) return [];
    return nodes.filter((node) =>
      extractSignalZoneRefs(node).some((code) => zoneRefComparableKey(code) === key),
    );
  }

  /** Zone (feature) correspondant au code joint d'un lot — remontée lot → zone. */
  function zoneFeatureForLot(
    lot: LotFeature,
    zoneFeatures: GeoZoneFeature[],
  ): GeoZoneFeature | null {
    const code = lotZoneCode(lot.properties);
    if (!code) return null;
    const key = zoneRefComparableKey(code);
    if (key.length === 0) return null;
    return (
      zoneFeatures.find((z) => zoneRefComparableKey(z.properties.code) === key) ?? null
    );
  }

  /** Badge zone d'un lot → déplie le bucket Zones et focalise la fiche zone. */
  function openZoneDetail(zone: GeoZoneFeature): void {
    const key = zoneKey(zone);
    if (!key) return;
    zonesBucketOpen = true;
    toggleEntity(key);
  }

  /** Signal citant une zone → déplie le bucket Signaux et focalise sa fiche. */
  function openSignalDetail(node: GraphSignalNode): void {
    const key = signalKey(node);
    if (!key) return;
    signalsBucketOpen = true;
    toggleEntity(key);
  }

  // ── m7 — Règlements ─────────────────────────────────────────────────────────
  /** Signal représentatif (porteur de preuve) d'un règlement, s'il existe. */
  function reglementEvidenceNode(entry: ReglementEntry): GraphSignalNode | null {
    if (!entry.evidenceNodeId) return null;
    return detailNodes.find((n) => n.id === entry.evidenceNodeId) ?? null;
  }

  /**
   * Visualise le PDF/source d'un règlement : on ouvre la SOURCE documentaire du
   * signal représentatif (le PV/document qui porte la citation du règlement)
   * dans le viewer partagé. rawRef same-origin en priorité (rendu PDF fiable).
   */
  function openReglementSource(entry: ReglementEntry): void {
    const node = reglementEvidenceNode(entry);
    if (!node) return;
    const evidence = signalEvidence(node);
    onOpenSource({
      title: `Règlement ${entry.number}`,
      sourceUrl: evidence.documentUrl ?? evidence.sourceUrl,
      rawRef: evidence.rawRef,
      page: evidence.page,
    });
  }

  /** Ouvre une grille de zonage PDF liée à un règlement dans le viewer. */
  function openGrillePdf(url: string, title: string): void {
    onOpenSource({ title, sourceUrl: url, rawRef: null, page: null });
  }

  /** Chip zone d'un règlement → ouvre la fiche zone si la zone existe. */
  function openZoneByCode(code: string): void {
    const key = zoneRefComparableKey(code);
    if (key.length === 0) return;
    const zone = zones.find(
      (z) => zoneRefComparableKey(z.properties.code) === key,
    );
    if (zone) openZoneDetail(zone);
  }

  // ── m8 — Source de la zone ──────────────────────────────────────────────────
  /** Ouvre la source ouvrable d'une zone (grille PDF servie) dans le viewer. */
  function openZoneSource(zone: GeoZoneFeature): void {
    const descriptor = describeZoneSource(zone.properties);
    if (!descriptor.openUrl) return;
    onOpenSource({
      title: `Zone ${zone.properties.code} — source`,
      sourceUrl: descriptor.openUrl,
      rawRef: null,
      page: null,
    });
  }
</script>

<div class="sel">
  <div class="sel-head">
    <span class="sel-kicker">Sélection</span>
    {#if selectedCity}
      <button
        type="button"
        class="sel-clear"
        on:click={onClear}
        aria-label="Fermer la sélection"
      >
        <X class="h-3.5 w-3.5" aria-hidden="true" />
        Fermer
      </button>
    {/if}
  </div>

  {#if !selectedCity}
    <p class="sel-muted">
      Cliquez sur une ville dans la liste ou sur la carte pour constituer le bucket.
    </p>
  {:else}
    <div class="sel-city-head">
      <span class="sel-kicker" style="color: #0f766e;">Ville active</span>
      <h2 class="sel-city-title">{selectedCity.municipality.name}</h2>
      {#if selectedCity.municipality.mrc}
        <p class="sel-city-meta">MRC : {selectedCity.municipality.mrc}</p>
      {/if}
      <div class="sel-pill-row">
        <!-- #6 : "–" pendant le chargement du détail ; badges filtré/total (#improvement) -->
        <Badge tone={detailLoading || detailError ? "neutral" : (signalIsFiltered ? filteredSignalCount : totalSignalCount) > 0 ? "warning" : "neutral"}>
          {#if detailLoading}
            –
          {:else if detailError}
            n/d
          {:else if signalIsFiltered}
            {filteredSignalCount}/{totalSignalCount} signal{totalSignalCount !== 1 ? "aux" : ""}
          {:else}
            {formatSignalCount(totalSignalCount)}
          {/if}
        </Badge>
        {#if zonesUnavailableReason}
          <Badge tone="neutral">zones non configurées</Badge>
        {:else}
          <!-- #6 : "–" pendant le chargement de la couche ZONES -->
          <Badge tone={zonesLoading ? "neutral" : zonesError ? "warning" : configuredZoneCount > 0 ? "info" : "neutral"}>
            {zonesLoading ? "–" : zonesError ? "n/d" : zoneBadgeText}
          </Badge>
        {/if}
        {#if lotsUnavailableReason}
          <Badge tone="neutral">lots non configurés</Badge>
        {:else}
          <!-- #6 : "–" pendant le chargement de la couche LOTS -->
          <Badge tone={lotsLoading ? "neutral" : lotsError ? "warning" : lotTotalCount > 0 ? "success" : "neutral"}>
            {lotsLoading ? "–" : lotsError ? "n/d" : formatCount(lotTotalCount, "lot", "lots")}
          </Badge>
        {/if}
      </div>
    </div>

    {#if detailError}
      <div class="sel-alert">
        <Alert tone="error" title="Signaux indisponibles" message={detailError} />
        <button type="button" class="sel-retry" on:click={onRetryDetail}>
          <RefreshCw class="h-3 w-3" aria-hidden="true" />
          Réessayer
        </button>
      </div>
    {/if}
    {#if zonesError}
      <div class="sel-alert">
        <Alert tone="warning" title="Zones indisponibles" message={zonesError} />
        <button type="button" class="sel-retry" on:click={onRetryGeo}>
          <RefreshCw class="h-3 w-3" aria-hidden="true" />
          Réessayer
        </button>
      </div>
    {/if}
    {#if lotsError}
      <div class="sel-alert">
        <Alert tone="warning" title="Lots indisponibles" message={lotsError} />
        <button type="button" class="sel-retry" on:click={onRetryGeo}>
          <RefreshCw class="h-3 w-3" aria-hidden="true" />
          Réessayer
        </button>
      </div>
    {/if}

    <div class="sel-buckets" bind:this={bucketsEl}>
      <!-- #8 : replié par défaut ; s'ouvre aussi via un lien croisé zone→signal -->
      <details class="sel-bucket" bind:open={signalsBucketOpen}>
        <summary class="sel-bucket-head">
          <span class="sel-bucket-name">Signaux</span>
          <!-- #6 : "–" pendant le chargement ; filtré/total si filtre actif -->
          <span class="rail-row-count">
            {#if detailLoading}–{:else if detailError}n/d{:else if signalIsFiltered}{filteredSignalCount}/{totalSignalCount}{:else}{totalSignalCount}{/if}
          </span>
        </summary>
        <div class="sel-entities" bind:this={entityListEl}>
          {#if detailLoading}
            <div class="sel-loading">
              <RefreshCw class="h-4 w-4 animate-spin" aria-hidden="true" />
              <span>Chargement des signaux…</span>
            </div>
          {:else if detailError}
            <p class="sel-empty">Projection des signaux indisponible.</p>
          {:else if filteredDetailNodes.length === 0}
            <!-- Des signaux existent mais la plage de dates / les filtres les
                 masquent tous : ne pas prétendre que la ville n'a rien d'indexé. -->
            <p class="sel-empty">
              {unfilteredSignalCount > 0
                ? "Aucun signal dans la plage de dates sélectionnée."
                : "Aucun signal indexé pour cette ville."}
            </p>
          {:else}
            {#each filteredDetailNodes as node (node.id)}
              {@const key = signalKey(node)}
              {#if key}
                {@const nodeVisual = visual(selectionState, key)}
                <!-- #86 — fiche : ancre de scroll (data-signal-node) + état
                     cross-survolé quand le viewer survole ce signal. Survoler
                     la fiche notifie le parent (→ le surlignage PDF pulse). -->
                <div
                  class="sel-entity-bar"
                  class:sel-entity-bar--xhover={hoveredSignalId === node.id}
                  data-signal-node={node.id}
                  role="presentation"
                  on:mouseenter={() => onHoverSignal(node.id)}
                  on:mouseleave={() => onHoverSignal(null)}
                  on:focusin={() => onHoverSignal(node.id)}
                  on:focusout={() => onHoverSignal(null)}
                >
                  <button
                    type="button"
                    class="sel-entity-head"
                    class:sel-entity-head--selected={nodeVisual.selected}
                    class:sel-entity-head--focused={nodeVisual.focused}
                    class:sel-entity-head--dimmed={nodeVisual.dimmed}
                    on:click={() => toggleEntity(key)}
                  >
                    <span class="sel-entity-label">{node.label}</span>
                    {#if isPiiaLie(node)}
                      <!-- PIIA porteur d'un projet résidentiel prouvé : gardé,
                           mais annoncé comme instrument indirect (confiance
                           faible), pas comme un rezonage. -->
                      <span
                        class="signal-piia-badge"
                        title="PIIA rattaché à un projet résidentiel (unités ou logements cités) — instrument indirect, à confirmer."
                      >
                        {PIIA_LIE_BADGE}
                      </span>
                    {/if}
                    <span class="sel-entity-type">{nodeTypeLabel(node.type)}</span>
                  </button>

                  {#if vivierBMode && node.classification}
                    <!-- Vue B : POURQUOI ce signal est à ce rang. Copy NEUTRE
                         (instrument + étape), lisible sans ouvrir la fiche. Le
                         statut d'effet densifiant est HONNÊTE : « à qualifier »
                         quand inconnu (invariant D10), jamais une valeur
                         inventée ni présentée comme favorable. -->
                    <div class="signal-rank-row">
                      <span class="signal-rank-reason">
                        {vivierRankReasonLabel(node.classification)}
                      </span>
                      <Badge
                        tone={isEffetDensifiantUnknown(node.classification) ? "neutral" : "info"}
                        size="sm"
                      >
                        Effet densifiant : {vivierEffetDensifiantLabel(node.classification)}
                      </Badge>
                    </div>
                  {/if}

                  {#if nodeVisual.focused}
                    {@const evidence = signalEvidence(node)}
                    {@const coPv = coPvSignalCount(node)}
                    <div class="sel-entity-detail">
                      <!-- ID du signal + pastille couleur : lien visuel avec le
                           surlignage de la preuve (#84). La pastille reprend la
                           couleur du signal COURANT du viewer (rang 0). -->
                      <div class="signal-id-row">
                        <span
                          class="signal-color-dot"
                          style="background:{signalColor()}"
                          aria-hidden="true"
                        ></span>
                        <span class="signal-id-key">Signal</span>
                        <code class="signal-id-val" title={node.id}>{node.id}</code>
                        {#if coPv > 0}
                          <span
                            class="signal-copv-badge"
                            title="Ce procès-verbal porte {coPv + 1} signaux : la preuve les surligne tous, chacun d'une couleur."
                          >
                            +{coPv} sur ce PV
                          </span>
                        {/if}
                      </div>
                      {#if evidence.description}
                        <p class="entity-summary">{evidence.description}</p>
                      {:else}
                        <p class="entity-summary entity-summary--missing">
                          Description non fournie par le graphe actuel.
                        </p>
                      {/if}
                      <div class="entity-meta">
                        {#if nodeReglement(node)}
                          <span class="entity-meta-key">Règlement</span>
                          <code class="entity-meta-val">{nodeReglement(node)}</code>
                        {/if}
                        {#if nodeZoneRef(node)}
                          <span class="entity-meta-key">Zone</span>
                          <code class="entity-meta-val">{nodeZoneRef(node)}</code>
                        {/if}
                        {#if formatDate(signalPublishedAt(node))}
                          <span class="entity-meta-key">Publié</span>
                          <span class="entity-meta-val">{formatDate(signalPublishedAt(node))}</span>
                        {:else if formatDate(node.createdAt)}
                          <span class="entity-meta-key">Ingestion</span>
                          <span class="entity-meta-val">{formatDate(node.createdAt)}</span>
                        {/if}
                        <span class="entity-meta-key">Date doc.</span>
                        <span
                          class="entity-meta-val"
                          class:entity-meta-val--missing={!formatDocumentDate(evidence.documentDate)}
                        >
                          {formatDocumentDate(evidence.documentDate) ?? "non disponible"}
                        </span>
                        <span class="entity-meta-key">Page</span>
                        <span
                          class="entity-meta-val"
                          class:entity-meta-val--missing={evidence.page === null}
                        >
                          {evidence.page ?? "non disponible"}
                        </span>
                        <span class="entity-meta-key">BBox</span>
                        <span
                          class="entity-meta-val"
                          class:entity-meta-val--missing={!formatBbox(evidence.bbox)}
                          title={formatBbox(evidence.bbox) ?? undefined}
                        >
                          {formatBbox(evidence.bbox) ?? "non disponible"}
                        </span>
                      </div>

                      <div class="doc-refs-section">
                        <span class="doc-refs-label">Preuve</span>
                        {#if evidence.provisional}
                          <!-- Filet Radar : PV rattaché AUTOMATIQUEMENT (provisional +
                               linkSource "radar-auto-link"), distinct d'une citation
                               graphify vérifiée. Badge DISCRET, ton info/neutre. -->
                          <div
                            class="auto-link-row"
                            title="PV rattaché automatiquement par Radar (à confirmer) — distinct d'une citation vérifiée."
                          >
                            <Badge tone="info" size="sm">
                              <span aria-label="Source liée automatiquement par le filet Radar, à confirmer">
                                Source liée automatiquement
                              </span>
                            </Badge>
                          </div>
                        {/if}
                        <div class="evidence-status-grid">
                          {#each evidenceCompletenessItems(evidence) as item (item.label)}
                            <span
                              class="evidence-chip"
                              class:evidence-chip--ok={item.ok}
                              class:evidence-chip--missing={!item.ok}
                            >
                              {item.label} : {item.ok ? "présent" : "manquant"}
                            </span>
                          {/each}
                        </div>

                        {#if evidenceText(evidence.excerpt ?? evidence.citation)}
                          <blockquote class="doc-ref-excerpt doc-ref-excerpt--citation">
                            {evidenceText(evidence.excerpt ?? evidence.citation)}
                          </blockquote>
                        {:else}
                          <p class="doc-refs-empty">
                            Citation/extrait non disponible pour ce signal.
                          </p>
                        {/if}

                        <div class="source-action-row">
                          {#if hasSourceEvidence(evidence)}
                            <button
                              type="button"
                              class="doc-ref-button"
                              on:click={() => openEvidence(node)}
                              title="Ouvrir la preuve dans un overlay"
                            >
                              <FileText class="h-3.5 w-3.5" aria-hidden="true" />
                              Voir la preuve{evidence.page !== null ? ` · p.${evidence.page}` : ""}
                            </button>
                          {:else}
                            <!-- #94 — affichage HONNÊTE : pas de bouton mort muet (rond
                                 barré silencieux). Aucune source documentaire n'est
                                 reliée à ce signal → on dit pourquoi, explicitement. -->
                            <div class="evidence-unavailable" role="note">
                              <FileX class="h-3.5 w-3.5" aria-hidden="true" />
                              <span>
                                Preuve non disponible — aucune source documentaire
                                reliée à ce signal pour l'instant.
                              </span>
                            </div>
                          {/if}
                        </div>
                      </div>
                    </div>
                  {/if}
                </div>
              {/if}
            {/each}
          {/if}
        </div>
      </details>

      <!-- m7 — RÈGLEMENTS : accordéon ENTRE Signaux et Zones. Dérivés des
           signaux (numéro de règlement cité + zones + preuve). Le module ouvre
           le PDF du règlement dans le viewer partagé (réutilisé). -->
      <details class="sel-bucket" bind:open={reglementsBucketOpen}>
        <summary class="sel-bucket-head">
          <span class="sel-bucket-name">Règlements</span>
          <span class="rail-row-count">
            {detailLoading ? "–" : reglements.length}
          </span>
        </summary>
        <div class="sel-entities">
          {#if detailLoading}
            <div class="sel-loading">
              <RefreshCw class="h-4 w-4 animate-spin" aria-hidden="true" />
              <span>Chargement des règlements…</span>
            </div>
          {:else if reglements.length === 0}
            <p class="sel-empty">
              Aucun règlement cité par les signaux de cette ville.
            </p>
          {:else}
            {#each reglements as reg (reg.key)}
              <div class="sel-entity-bar">
                <div class="reglement-row">
                  <div class="reglement-head">
                    <code class="reglement-number">{reg.number}</code>
                    <span class="reglement-count">
                      {formatSignalCount(reg.signalCount)}
                    </span>
                  </div>
                  {#if reg.zoneCodes.length > 0}
                    <div class="reglement-zones">
                      <span class="reglement-zones-label">Zones</span>
                      {#each reg.zoneCodes as code (code)}
                        <button
                          type="button"
                          class="lot-zone-badge"
                          on:click={() => openZoneByCode(code)}
                          title="Ouvrir le détail de la zone"
                        >
                          {code}
                        </button>
                      {/each}
                    </div>
                  {/if}
                  <div class="reglement-actions">
                    {#if reg.evidenceNodeId}
                      <button
                        type="button"
                        class="doc-ref-button"
                        on:click={() => openReglementSource(reg)}
                        title="Visualiser le document source du règlement"
                      >
                        <FileText class="h-3.5 w-3.5" aria-hidden="true" />
                        Voir le PDF
                      </button>
                    {:else}
                      <span class="reglement-nosrc">
                        <FileX class="h-3.5 w-3.5" aria-hidden="true" />
                        Document source non relié
                      </span>
                    {/if}
                    {#each reg.grillePdfUrls as url (url)}
                      <button
                        type="button"
                        class="doc-ref-button"
                        on:click={() =>
                          openGrillePdf(url, `Grille de zonage — ${reg.number}`)}
                        title="Ouvrir la grille de zonage PDF"
                      >
                        <FileText class="h-3.5 w-3.5" aria-hidden="true" />
                        Grille PDF
                      </button>
                    {/each}
                  </div>
                </div>
              </div>
            {/each}
          {/if}
        </div>
      </details>

      <!-- #8 : replié par défaut ; s'ouvre aussi via le badge zone d'un lot -->
      <details class="sel-bucket" bind:open={zonesBucketOpen}>
        <summary class="sel-bucket-head">
          <span class="sel-bucket-name">Zones</span>
          <!-- #6 : "–" pendant le chargement de la couche ZONES -->
          <span class="rail-row-count">
            {zonesLoading
              ? "–"
              : zonesError
              ? "n/d"
              : zonesUnavailableReason
              ? "n/d"
              : zonesResponse?.resolutionStatus === "fallback" && configuredZoneCount === 0
              ? "fallback"
              : zoneListFiltered
              ? `${visibleZoneCount}/${configuredZoneCount}`
              : configuredZoneCount}
          </span>
        </summary>
        <div class="sel-entities">
          {#if zonesLoading}
            <div class="sel-loading">
              <RefreshCw class="h-4 w-4 animate-spin" aria-hidden="true" />
              <span>Chargement des zones…</span>
            </div>
          {:else if zonesError}
            <div class="sel-loading">
              <span>Zones indisponibles.</span>
              <button type="button" class="sel-retry sel-retry--inline" on:click={onRetryGeo}>Réessayer</button>
            </div>
          {:else if zonesUnavailableReason}
            <p class="sel-empty">{zonesUnavailableReason}</p>
          {:else if zones.length === 0}
            <p class="sel-empty">Aucune zone géométrique disponible.</p>
          {:else}
            <!-- En-tête de filtre par TYPE de zone — AU-DESSUS de la liste,
                 visible quand l'accordéon est ouvert. Rendu même quand le
                 filtre vide la liste (sinon impossible de le désactiver). -->
            <ZoneFilterHeader
              zones={zoneFilterInput}
              filter={zoneKindFilter}
              onChange={onZoneKindFilterChange}
              millesimeZones={zoneMillesimeInput}
              millesimeFilter={zoneMillesimeFilter}
              onMillesimeChange={onZoneMillesimeFilterChange}
            />
            {#if visibleZones.length === 0}
              <p class="sel-empty">
                {zoneKindFilterActive || zoneMillesimeFilterActive
                  ? "Aucune zone du filtre sélectionné."
                  : "Aucune zone liée aux signaux du filtre actif."}
              </p>
            {:else}
            {#if zonesResponse?.warnings.includes("lot-union-fallback-is-visual-only")}
              <p class="sel-warning">Fallback visuel : les zones sont dérivées de groupes de lots.</p>
            {/if}
            {#each visibleZones as zone (`${zone.properties.citySlug}-${zone.properties.code}`)}
              {@const key = zoneKey(zone)}
              {#if key}
                {@const zoneVisual = visual(selectionState, key)}
                <div class="sel-entity-bar" data-entity-key={key}>
                  <button
                    type="button"
                    class="sel-entity-head"
                    class:sel-entity-head--selected={zoneVisual.selected}
                    class:sel-entity-head--focused={zoneVisual.focused}
                    class:sel-entity-head--dimmed={zoneVisual.dimmed}
                    on:click={() => toggleEntity(key)}
                  >
                    <span class="sel-entity-label">
                      {zone.properties.label ?? zone.properties.code}
                    </span>
                    <span class="sel-entity-type">{zone.properties.code}</span>
                  </button>
                  {#if zoneVisual.focused}
                    <!-- Détail ZONE (contrat d'interaction) : code, type (kind),
                         lots joints, grille PDF, signaux citant la zone. -->
                    {@const citing = signalsCitingZone(zone, detailNodes)}
                    {@const zoneSource = describeZoneSource(zone.properties)}
                    {@const zoneReg = zoneReglementRow(zone)}
                    <div class="sel-entity-detail">
                      <div class="entity-meta">
                        <span class="entity-meta-key">Code</span>
                        <code class="entity-meta-val">{zone.properties.code}</code>
                        <span class="entity-meta-key">Type</span>
                        {#if zoneTypeLabel(zone)}
                          <span class="entity-meta-val">{zoneTypeLabel(zone)}</span>
                        {:else}
                          <span class="entity-meta-val entity-meta-val--missing">—</span>
                        {/if}
                        <!-- m6 — millésime + n° de règlement PAR ZONE (axe
                             millésime) ; rendu seulement quand geo le sert. -->
                        {#if zoneReg}
                          <span class="entity-meta-key">{zoneReg.key}</span>
                          <span class="entity-meta-val" data-testid="zone-reglement-millesime"
                            >{zoneReg.value}</span
                          >
                        {/if}
                        <span class="entity-meta-key">Source</span>
                        <span class="entity-meta-val">{zoneSourceLabel(zone)}</span>
                        <!-- m8.2 — type de source dérivé (recalage / GeoJSON dans
                             PDF / site / …) mappé depuis source+géométrie+confiance. -->
                        <span class="entity-meta-key">Type de source</span>
                        <span class="entity-meta-val">{zoneSource.label}</span>
                        <span class="entity-meta-key">Géométrie</span>
                        <span class="entity-meta-val">{zoneGeometryLabel(zone)}</span>
                        <span class="entity-meta-key">Confiance</span>
                        <span class="entity-meta-val">{confidencePct(zone.properties.confidence)}</span>
                        <span class="entity-meta-key">Lots liés</span>
                        <span class="entity-meta-val">{formatNumber(zoneLotCount(zone, lots))}</span>
                      </div>
                      <!-- m8.1 — source de la zone OUVRABLE dans le viewer
                           partagé : PDF si l'URL est un PDF, iframe sinon (le
                           viewer décide). Aujourd'hui seule la grille PDF est
                           servie ; site/screenshot restent un ask geo (note PR). -->
                      <div class="zone-source-actions">
                        {#if zoneSource.openUrl}
                          <button
                            type="button"
                            class="doc-ref-button"
                            on:click={() => openZoneSource(zone)}
                            title="Ouvrir la source de la zone dans le viewer"
                          >
                            <FileText class="h-3.5 w-3.5" aria-hidden="true" />
                            Ouvrir la source ({zoneSource.openKind === "pdf"
                              ? "PDF"
                              : "site"})
                          </button>
                        {:else}
                          <p class="doc-refs-empty">
                            Source non ouvrable : aucune URL de source servie pour
                            cette zone.
                          </p>
                        {/if}
                        {#if zoneSource.approximate}
                          <p class="zone-source-note">
                            Provenance affichée par défaut ; la distinction site /
                            GeoJSON dans PDF / recalage n'est pas encore fournie par
                            la source.
                          </p>
                        {/if}
                      </div>
                      <div class="zone-signals">
                        <span class="doc-refs-label">Signaux citant la zone</span>
                        {#if citing.length === 0}
                          <p class="doc-refs-empty">Aucun signal ne cite cette zone.</p>
                        {:else}
                          <ul class="zone-signal-list">
                            {#each citing as node (node.id)}
                              <li>
                                <button
                                  type="button"
                                  class="zone-signal-link"
                                  on:click={() => openSignalDetail(node)}
                                  title="Ouvrir la fiche du signal"
                                >
                                  {node.label}
                                </button>
                              </li>
                            {/each}
                          </ul>
                        {/if}
                      </div>
                    </div>
                  {/if}
                </div>
              {/if}
            {/each}
            {/if}
          {/if}
        </div>
      </details>

      <details class="sel-bucket" bind:open={lotsBucketOpen}>
        <summary class="sel-bucket-head">
          <span class="sel-bucket-name">Lots</span>
          <!-- #6 : "–" pendant le chargement ; « N/M » quand le filtre lots
               est actif (reste visible accordéon fermé — état persistant). -->
          <span class="rail-row-count">
            {lotsLoading
              ? "–"
              : lotsError
              ? "n/d"
              : lotsUnavailableReason
              ? "n/d"
              : lotFilterActive
              ? `${formatNumber(lotMatchedCount)}/${formatNumber(lots.length)}`
              : formatNumber(lotTotalCount)}
          </span>
        </summary>
        <div class="sel-entities">
          {#if lotsLoading}
            <div class="sel-loading">
              <RefreshCw class="h-4 w-4 animate-spin" aria-hidden="true" />
              <span>Chargement des lots…</span>
            </div>
          {:else if lotsError}
            <div class="sel-loading">
              <span>Lots indisponibles.</span>
              <button type="button" class="sel-retry sel-retry--inline" on:click={onRetryGeo}>Réessayer</button>
            </div>
          {:else if lotsUnavailableReason}
            <p class="sel-empty">{lotsUnavailableReason}</p>
          {:else if lots.length === 0}
            <p class="sel-empty">Aucun lot retourné par la collection geo.</p>
          {:else}
            <!-- En-tête de filtre LOTS (eval-lot-filters réutilisé) — AU-DESSUS
                 de la liste, visible quand l'accordéon est ouvert. Rendu même
                 quand le filtre vide la liste (pour pouvoir le désactiver).
                 Base = TOUS les lots chargés (miroir de la peinture carte). -->
            <LotFilterHeader
              {lots}
              filter={lotFilter}
              onChange={onLotFilterChange}
            />
            {#if visibleLots.length === 0}
              <p class="sel-empty">Aucun lot ne correspond aux filtres actifs.</p>
            {:else}
            {#if hiddenLotCount > 0}
              <p class="sel-warning">
                {formatNumber(visibleLots.length)} lots affichés sur {formatNumber(lotListTotal)} disponibles.
              </p>
            {/if}
            {#each visibleLots as lot (lot.properties.noLot)}
              {@const key = lotKey(lot)}
              {#if key}
                {@const lotVisual = visual(selectionState, key)}
                <div class="sel-entity-bar" data-entity-key={key}>
                  <button
                    type="button"
                    class="sel-entity-head"
                    class:sel-entity-head--selected={lotVisual.selected}
                    class:sel-entity-head--focused={lotVisual.focused}
                    class:sel-entity-head--dimmed={lotVisual.dimmed}
                    on:click={() => toggleEntity(key)}
                  >
                    <span class="sel-entity-label">{lot.properties.noLot}</span>
                    <span class="sel-entity-type">{lotScore(lot) ?? "lot"}</span>
                  </button>
                  {#if lotVisual.focused}
                    <!-- Carte lot enrichie (#314) : zone (code, badge cliquable →
                         détail zone), 4+, superficie, TOD/priorité si présents.
                         Champs absents = « — » discret ; score non évalué =
                         « non évalué », jamais « 0.0/10 ». -->
                    {@const lotZoneFeature = zoneFeatureForLot(lot, zones)}
                    <div class="sel-entity-detail">
                      <div class="entity-meta">
                        <span class="entity-meta-key">Lot</span>
                        <code class="entity-meta-val">{lot.properties.noLot}</code>
                        <span class="entity-meta-key">Zone</span>
                        {#if lotZoneFeature}
                          <span class="entity-meta-val">
                            <button
                              type="button"
                              class="lot-zone-badge"
                              on:click={() => openZoneDetail(lotZoneFeature)}
                              title="Ouvrir le détail de la zone"
                            >
                              {lotZoneCode(lot.properties) ?? lotZoneFeature.properties.code}
                            </button>
                          </span>
                        {:else if lotZoneCode(lot.properties)}
                          <code class="entity-meta-val">{lotZoneCode(lot.properties)}</code>
                        {:else}
                          <span class="entity-meta-val entity-meta-val--missing">—</span>
                        {/if}
                        {#if lotZoneKind(lot)}
                          <span class="entity-meta-key">Type de zone</span>
                          <span class="entity-meta-val">{lotZoneKind(lot)}</span>
                        {/if}
                        <!-- Usage dominant servi par geo (`qc-zonage-<slug>`) :
                             valeur RÉELLE + sa source ; rangée masquée quand geo
                             ne le sert pas (jamais une classification inventée). -->
                        {#if usageDominantDisplay(lot.properties.zone)}
                          <span class="entity-meta-key">Usage dominant</span>
                          <span class="entity-meta-val">{usageDominantDisplay(lot.properties.zone)}</span>
                        {/if}
                        <!-- Adresse + code postal servis par geo : adresse
                             civique du rôle (« — » quand non résolue) ; code
                             postal en FSA 3 caractères (ex. « J3Y ») affiché
                             tel quel avec libellé discret « (secteur) ». -->
                        <span class="entity-meta-key">Adresse</span>
                        <span
                          class="entity-meta-val"
                          class:entity-meta-val--missing={!lot.properties.adresse}
                          title={lot.properties.adresse ?? undefined}
                        >
                          {lot.properties.adresse ?? "—"}
                        </span>
                        <span class="entity-meta-key">Code postal</span>
                        <span
                          class="entity-meta-val"
                          class:entity-meta-val--missing={!lot.properties.codePostal}
                        >
                          {formatPostalCode(lot.properties.codePostal)}
                        </span>
                        <span class="entity-meta-key">Multifamilial 4+</span>
                        <span
                          class="entity-meta-val"
                          class:entity-meta-val--missing={lot.properties.multifamilial4plus === undefined}
                        >
                          {lot4Plus(lot)}
                        </span>
                        <span class="entity-meta-key">Superficie</span>
                        <span
                          class="entity-meta-val"
                          class:entity-meta-val--missing={lot.properties.superficieM2 === undefined || lot.properties.superficieM2 === null}
                        >
                          {formatArea(lot.properties.superficieM2)}
                        </span>
                        <!-- C5 — façade : mesurée par la source sinon estimée
                             depuis la géométrie publique (lot-fiche-utils). -->
                        <span class="entity-meta-key">Façade</span>
                        <span
                          class="entity-meta-val"
                          class:entity-meta-val--missing={facadeDisplay(lot) === "—"}
                        >
                          {facadeDisplay(lot)}
                        </span>
                        {#if lot.properties.tod !== undefined}
                          <span class="entity-meta-key">Périmètre TOD</span>
                          <span class="entity-meta-val">{formatYesNo(lot.properties.tod)}</span>
                        {/if}
                        {#if lot.properties.priorite !== undefined && lot.properties.priorite !== null}
                          <span class="entity-meta-key">Priorité</span>
                          <span class="entity-meta-val">{formatYesNo(lot.properties.priorite)}</span>
                        {/if}
                        <!-- Normes de zonage foldées par lot (servies par geo
                             via zone_code) : valeur + unité VERBATIM quand
                             servies, « — » sinon — JAMAIS de valeur inventée.
                             « Façade min »/« Superficie min » = NORMES de
                             grille, distinctes de Façade/Superficie réelles. -->
                        <span class="entity-meta-section">Normes de zonage</span>
                        {#each lotNormesRows(lot.properties.normes) as [label, value] (label)}
                          <span class="entity-meta-key">{label}</span>
                          <span
                            class="entity-meta-val"
                            class:entity-meta-val--missing={value === "—"}
                          >
                            {value}
                          </span>
                        {/each}
                        <span class="entity-meta-key">Potentiel</span>
                        {#if lotScore(lot)}
                          <span class="entity-meta-val">{lotScore(lot)}</span>
                        {:else}
                          <span class="entity-meta-val entity-meta-val--missing">non évalué</span>
                        {/if}
                        <span class="entity-meta-key">Source</span>
                        <span class="entity-meta-val">{lotsResponse?.source ?? "inconnue"}</span>
                        {#if lotsResponse?.collectionId}
                          <span class="entity-meta-key">Collection</span>
                          <code class="entity-meta-val">{lotsResponse.collectionId}</code>
                        {/if}
                      </div>
                    </div>
                  {/if}
                </div>
              {/if}
            {/each}
            {/if}
          {/if}
        </div>
      </details>
    </div>
  {/if}
</div>


<style>
  /*
   * Typographie panneau Signaux alignée DS.
   * Les tailles de texte ne sont plus portées par des rem dispersés : les
   * classes consomment ces aliases raccordés aux tokens DS.
   */
  .sel {
    --signaux-fs-overline: var(--st-component-label-fontSize, 0.6875rem);
    --signaux-fs-caption: var(--st-component-caption-fontSize, 0.6875rem);
    --signaux-fs-small: var(--st-component-tag-fontSize, 0.75rem);
    --signaux-fs-body: var(--st-component-body-sm-fontSize, 0.8125rem);
    --signaux-fs-title: var(--st-component-title-sm-fontSize, 1rem);
  }

  .sel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow-y: auto;
    background: var(--st-semantic-surface-default, #fff);
  }

  .sel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.6rem 0.85rem;
    border-bottom: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
    flex-shrink: 0;
  }

  .sel-kicker {
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: var(--signaux-fs-overline);
    font-weight: 700;
    color: var(--st-semantic-text-muted, #94a3b8);
  }

  .sel-clear {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: var(--signaux-fs-small);
    padding: 0.2rem 0.5rem;
    border: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
    border-radius: var(--st-radius-sm, 4px);
    background: transparent;
    color: var(--st-semantic-text-secondary, #64748b);
    cursor: pointer;
  }

  .sel-clear:hover {
    background: var(--st-semantic-surface-subtle, #f8fafc);
  }

  .sel-muted,
  .sel-empty {
    padding: 0.6rem 0.85rem;
    color: var(--st-semantic-text-muted, #94a3b8);
    font-size: var(--signaux-fs-body);
    font-style: italic;
  }

  .sel-warning {
    margin: 0.35rem 0.85rem;
    color: #92400e;
    font-size: var(--signaux-fs-small);
  }

  .sel-alert {
    padding: 0.5rem 0.85rem 0;
  }

  /* « Réessayer » par couche : action neutre, discrète, sous l'alerte. */
  .sel-retry {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    margin: 0.35rem 0 0;
    padding: 0.2rem 0.5rem;
    border: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
    border-radius: var(--st-radius-sm, 4px);
    background: transparent;
    color: var(--st-semantic-text-secondary, #64748b);
    font-size: var(--signaux-fs-small);
    font-weight: 600;
    cursor: pointer;
  }

  .sel-retry:hover {
    background: var(--st-semantic-surface-subtle, #f8fafc);
  }

  .sel-retry--inline {
    margin: 0;
  }

  .sel-city-head {
    padding: 0.75rem 0.85rem;
    border-bottom: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
    flex-shrink: 0;
  }

  .sel-city-title {
    font-size: var(--signaux-fs-title);
    font-weight: 600;
    color: var(--st-semantic-text-primary, #1e293b);
    margin: 0.2rem 0 0.3rem;
  }

  .sel-city-meta {
    font-size: var(--signaux-fs-body);
    color: var(--st-semantic-text-muted, #94a3b8);
    margin: 0.15rem 0 0.45rem;
  }

  .sel-pill-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .sel-loading {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 0.85rem;
    font-size: var(--signaux-fs-body);
    color: var(--st-semantic-text-muted, #94a3b8);
  }

  .sel-buckets {
    flex: 1;
    overflow-y: auto;
  }

  .sel-bucket {
    border-bottom: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
  }

  .sel-bucket-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.45rem 0.85rem;
    cursor: pointer;
    user-select: none;
    background: var(--st-semantic-surface-subtle, #f8fafc);
    font-size: var(--signaux-fs-body);
    font-weight: 600;
    color: var(--st-semantic-text-secondary, #475569);
    list-style: none;
  }

  .sel-bucket-head::-webkit-details-marker {
    display: none;
  }

  .sel-bucket-head::before {
    content: "▸";
    font-size: var(--signaux-fs-caption);
    color: var(--st-semantic-text-muted, #94a3b8);
    transition: transform 0.12s ease;
    flex-shrink: 0;
  }

  details[open] > .sel-bucket-head::before {
    transform: rotate(90deg);
  }

  .sel-bucket-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rail-row-count {
    font-variant-numeric: tabular-nums;
    font-size: var(--signaux-fs-overline);
    border-radius: var(--st-radius-pill, 999px);
    flex-shrink: 0;
    background: var(--st-semantic-surface-subtle, #f1f5f9);
    padding: 0 0.4rem;
    line-height: 1.5;
    color: var(--st-semantic-text-secondary, #64748b);
  }

  .sel-entities {
    padding: 0.25rem 0 0.5rem;
  }

  .sel-entity-bar {
    border-bottom: 1px solid var(--st-semantic-border-subtle, #f1f5f9);
  }

  .sel-entity-bar:last-child {
    border-bottom: none;
  }

  /* #86 — cross-highlight : la fiche correspondant au surlignage PDF survolé
     prend un état SÉLECTIONNÉ visible (liseré + fond) sans ouvrir le détail. */
  .sel-entity-bar--xhover {
    background: var(--st-semantic-surface-selected, #e0f2fe);
    box-shadow: inset 3px 0 0 var(--st-semantic-border-strong, #0ea5e9);
  }

  /* #10 — layout colonne : titre complet sur plusieurs lignes + sous-titre dessous */
  .sel-entity-head {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.15rem;
    width: 100%;
    padding: 0.34rem 0.85rem;
    font-size: var(--signaux-fs-body);
    text-align: left;
    cursor: pointer;
    background: transparent;
    color: var(--st-semantic-text-primary, #1e293b);
  }

  .sel-entity-head:hover {
    background: var(--st-semantic-surface-subtle, #f8fafc);
  }

  .sel-entity-head--selected {
    background: #ecfdf5;
    color: #0f766e;
    font-weight: 600;
  }

  .sel-entity-head--focused {
    outline: 1px solid #14b8a6;
    outline-offset: -1px;
  }

  .sel-entity-head--dimmed {
    opacity: 0.5;
  }

  /* #10 — titre complet, sans troncature */
  .sel-entity-label {
    width: 100%;
    font-size: var(--signaux-fs-body);
    line-height: 1.4;
    word-break: break-word;
    overflow-wrap: anywhere;
  }

  /* #10 — sous-titre (type) sur sa propre ligne */
  .sel-entity-type {
    width: 100%;
    color: var(--st-semantic-text-muted, #94a3b8);
    font-family: var(--st-font-mono, ui-monospace, monospace);
    font-size: var(--signaux-fs-caption);
  }


  .sel-entity-detail {
    padding: 0.45rem 0.85rem 0.65rem 1.15rem;
    background: #f8fafc;
    border-top: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
  }

  /* ── ID signal + pastille couleur (#84) ───────────────────────────────── */
  .signal-id-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-bottom: 0.5rem;
    flex-wrap: wrap;
  }

  .signal-color-dot {
    width: 0.7rem;
    height: 0.7rem;
    border-radius: 50%;
    flex-shrink: 0;
    box-shadow: 0 0 0 1px rgb(15 23 42 / 0.15);
  }

  .signal-id-key {
    color: var(--st-semantic-text-muted, #94a3b8);
    font-size: var(--signaux-fs-caption);
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .signal-id-val {
    overflow: hidden;
    max-width: 12rem;
    color: var(--st-semantic-text-secondary, #475569);
    font-size: var(--signaux-fs-overline);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .signal-copv-badge {
    padding: 0.05rem 0.4rem;
    border-radius: 999px;
    background: var(--st-semantic-warning-surface, #fef3c7);
    color: var(--st-semantic-warning-text, #92400e);
    font-size: var(--signaux-fs-caption);
    font-weight: 700;
  }

  /* PIIA lié : ton INFO discret — le signal est gardé, pas mis en avant. */
  .signal-piia-badge {
    flex-shrink: 0;
    padding: 0.05rem 0.4rem;
    border-radius: 999px;
    background: var(--st-semantic-info-surface, #e0f2fe);
    color: var(--st-semantic-info-text, #075985);
    font-size: var(--signaux-fs-caption);
    font-weight: 600;
    white-space: nowrap;
  }

  /* Vue B : ligne « raison du rang » sous le libellé du signal. Discrète,
     toujours visible (pas besoin d'ouvrir la fiche pour savoir pourquoi). */
  .signal-rank-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
    padding: 0.1rem 0.85rem 0.35rem 0.85rem;
  }

  .signal-rank-reason {
    color: var(--st-semantic-text-secondary, #475569);
    font-size: var(--signaux-fs-caption);
    font-weight: 600;
  }

  .entity-summary {
    margin: 0 0 0.45rem;
    color: var(--st-semantic-text-secondary, #475569);
    font-size: var(--signaux-fs-body);
    line-height: 1.45;
  }

  .entity-summary--missing {
    color: var(--st-semantic-text-muted, #64748b);
    font-style: italic;
  }

  .entity-meta {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.22rem 0.6rem;
    align-items: baseline;
  }

  .entity-meta-key {
    color: var(--st-semantic-text-muted, #94a3b8);
    font-size: var(--signaux-fs-caption);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  /* En-tête de sous-section de la fiche lot (ex. « Normes de zonage ») —
     s'étend sur les deux colonnes de la grille entity-meta. */
  .entity-meta-section {
    grid-column: 1 / -1;
    margin-top: 0.35rem;
    color: var(--st-semantic-text-muted, #94a3b8);
    font-size: var(--signaux-fs-overline);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .entity-meta-val {
    min-width: 0;
    overflow: hidden;
    color: var(--st-semantic-text-secondary, #475569);
    font-size: var(--signaux-fs-small);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .entity-meta-val--missing {
    color: var(--st-semantic-text-muted, #94a3b8);
    font-style: italic;
  }

  .doc-refs-section {
    margin-top: 0.55rem;
    border-top: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
    padding-top: 0.5rem;
  }

  .doc-refs-label {
    display: block;
    margin-bottom: 0.35rem;
    color: var(--st-semantic-text-muted, #94a3b8);
    font-size: var(--signaux-fs-caption);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .doc-refs-sub-label {
    display: block;
    margin: 0.45rem 0 0.25rem;
    color: var(--st-semantic-text-muted, #94a3b8);
    font-size: var(--signaux-fs-caption);
    font-weight: 700;
  }

  .doc-refs-empty {
    margin: 0;
    color: var(--st-semantic-text-muted, #94a3b8);
    font-size: var(--signaux-fs-small);
    font-style: italic;
  }

  /* Filet Radar : ligne du badge « source liée automatiquement ». Discrète,
     juste un petit espacement sous le label « Preuve ». La couleur/forme du
     badge vient des tokens DS (tone="info"). */
  .auto-link-row {
    display: flex;
    align-items: center;
    margin-bottom: 0.35rem;
    cursor: help;
  }

  .evidence-status-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }

  .evidence-chip {
    display: inline-flex;
    align-items: center;
    min-height: 1.25rem;
    border-radius: var(--st-radius-sm, 4px);
    padding: 0.05rem 0.35rem;
    font-size: var(--signaux-fs-caption);
    font-weight: 650;
    line-height: 1.25;
  }

  .evidence-chip--ok {
    border: 1px solid #99f6e4;
    background: #f0fdfa;
    color: #0f766e;
  }

  .evidence-chip--missing {
    border: 1px solid #fed7aa;
    background: #fff7ed;
    color: #9a3412;
  }

  .source-action-row {
    margin: 0.5rem 0;
  }

  .doc-ref-button {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    min-height: 1.85rem;
    border: 1px solid #14b8a6;
    border-radius: var(--st-radius-sm, 4px);
    background: #f0fdfa;
    color: #0f766e;
    cursor: pointer;
    font-size: var(--signaux-fs-small);
    font-weight: 650;
    padding: 0.2rem 0.55rem;
  }

  .doc-ref-button:hover:not(:disabled) {
    background: #ccfbf1;
  }

  .doc-ref-button:disabled {
    border-color: var(--st-semantic-border-subtle, #e2e8f0);
    background: #f8fafc;
    color: var(--st-semantic-text-muted, #94a3b8);
    cursor: not-allowed;
  }

  /* #94 — état HONNÊTE « preuve non disponible » : remplace le bouton mort muet.
     Encart neutre explicite (pas un bouton désactivé), avec icône fichier barré. */
  .evidence-unavailable {
    display: flex;
    align-items: flex-start;
    gap: 0.4rem;
    border: 1px dashed var(--st-semantic-border-subtle, #cbd5e1);
    border-radius: var(--st-radius-sm, 4px);
    background: var(--st-semantic-surface-subtle, #f8fafc);
    color: var(--st-semantic-text-muted, #64748b);
    font-size: var(--signaux-fs-caption);
    line-height: 1.4;
    padding: 0.4rem 0.55rem;
  }

  .evidence-unavailable :global(svg) {
    flex-shrink: 0;
    margin-top: 0.1rem;
  }

  .doc-refs-list {
    display: grid;
    gap: 0.4rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .doc-ref-item {
    display: grid;
    gap: 0.12rem;
    min-width: 0;
  }

  .doc-ref-link {
    display: inline-flex;
    align-items: center;
    gap: 0.28rem;
    border: 0;
    background: transparent;
    color: #0f766e;
    cursor: pointer;
    font-size: var(--signaux-fs-small);
    font-weight: 600;
    text-decoration: none;
  }

  .doc-ref-link:hover {
    text-decoration: underline;
  }

  .doc-ref-sha {
    color: var(--st-semantic-text-muted, #94a3b8);
    font-family: var(--st-font-mono, ui-monospace, monospace);
    font-size: var(--signaux-fs-caption);
  }

  .doc-ref-excerpt {
    margin: 0.25rem 0 0;
    border-left: 2px solid #facc15;
    padding-left: 0.45rem;
    color: var(--st-semantic-text-secondary, #475569);
    font-size: var(--signaux-fs-small);
    line-height: 1.45;
  }

  .doc-ref-excerpt--citation {
    margin: 0.4rem 0 0.5rem;
    font-size: var(--signaux-fs-body);
    font-style: italic;
  }

  /* ── Contrat d'interaction zone ↔ lot ↔ signal ─────────────────────────── */

  /* Badge zone cliquable de la carte lot : remonte au détail de la zone. */
  .lot-zone-badge {
    display: inline-flex;
    align-items: center;
    border: 1px solid #99f6e4;
    border-radius: var(--st-radius-sm, 4px);
    background: #f0fdfa;
    color: #0f766e;
    cursor: pointer;
    font-family: var(--st-font-mono, ui-monospace, monospace);
    font-size: var(--signaux-fs-small);
    font-weight: 650;
    padding: 0.05rem 0.4rem;
  }

  .lot-zone-badge:hover {
    background: #ccfbf1;
  }

  /* m8 — bloc d'ouverture de la source de la zone (viewer partagé). */
  .zone-source-actions {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    margin-top: 0.5rem;
  }

  .zone-source-note {
    margin: 0;
    color: var(--st-semantic-text-muted, #94a3b8);
    font-size: var(--signaux-fs-caption);
    font-style: italic;
    line-height: 1.35;
  }

  /* m7 — ligne de règlement de l'accordéon Règlements. */
  .reglement-row {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.5rem 0.6rem;
  }

  .reglement-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.6rem;
  }

  .reglement-number {
    color: var(--st-semantic-text-secondary, #334155);
    font-family: var(--st-font-mono, ui-monospace, monospace);
    font-size: var(--signaux-fs-body);
    font-weight: 700;
  }

  .reglement-count {
    color: var(--st-semantic-text-muted, #94a3b8);
    font-size: var(--signaux-fs-caption);
    white-space: nowrap;
  }

  .reglement-zones {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3rem;
  }

  .reglement-zones-label {
    color: var(--st-semantic-text-muted, #94a3b8);
    font-size: var(--signaux-fs-caption);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .reglement-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
  }

  .reglement-nosrc {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    color: var(--st-semantic-text-muted, #94a3b8);
    font-size: var(--signaux-fs-caption);
    font-style: italic;
  }

  /* Signaux citant la zone (fiche zone). */
  .zone-signals {
    margin-top: 0.55rem;
    border-top: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
    padding-top: 0.5rem;
  }

  .zone-signal-list {
    display: grid;
    gap: 0.25rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .zone-signal-link {
    border: 0;
    background: transparent;
    color: #0f766e;
    cursor: pointer;
    font-size: var(--signaux-fs-small);
    font-weight: 600;
    padding: 0;
    text-align: left;
    line-height: 1.35;
  }

  .zone-signal-link:hover {
    text-decoration: underline;
  }
</style>
