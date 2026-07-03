# WPB-E2E — audit cohérence 33 opportunités

## Pistes code/données
ui/src/App.svelte:9:  import OpportunityFunnel from "$lib/components/opportunity/OpportunityFunnel.svelte";
ui/src/App.svelte:40:  let opportuniteSignalId: string | undefined = undefined;
ui/src/App.svelte:42:  let opportuniteSignalLabel: string | undefined = undefined;
ui/src/App.svelte:54:    "grid-cos-modification": "Modification grille/COS",
ui/src/App.svelte:68:    opportuniteSignalId = signal.id;
ui/src/App.svelte:69:    opportuniteSignalLabel = buildSignalLabel(signal);
ui/src/App.svelte:70:    navigateTo("opportunity");
ui/src/App.svelte:76:        label: opportuniteSignalLabel,
ui/src/App.svelte:82:  /** Efface le filtre d'opportunite et le chip de contexte du chat (P3). */
ui/src/App.svelte:84:    opportuniteSignalId = undefined;
ui/src/App.svelte:85:    opportuniteSignalLabel = undefined;
ui/src/App.svelte:179:        <!-- Vue Signaux : carte aplats GeoJSON coloriés par nb d'opportunités / 6 mois -->
ui/src/App.svelte:181:      {:else if activeView === "opportunity"}
ui/src/App.svelte:183:          selectedSignalId={opportuniteSignalId}
ui/src/App.svelte:184:          selectedSignalLabel={opportuniteSignalLabel}
ui/src/App.svelte:188:        <!-- Vue Évaluation : fusion EvaluationMapView + GrillesView (carte cadastrale + grilles) -->
ui/src/App.svelte:199:      {:else if activeView === "grilles"}
ui/src/App.svelte:207:      <!-- G3 — Vue Géo (zones + lots + opportunités) -->
ui/src/App.svelte:213:      {:else if activeView === "carte-opportunites"}
ui/src/lib/onboarding/onboarding-data.ts:80:    "Transforme un simple blocage en opportunite si une decision d'autorisation existe.",
ui/src/lib/onboarding/onboarding-data.ts:87:  "zonage-plans-grilles-valleyfield":
ui/src/lib/router/router.ts:41:  "opportunity",
ui/src/lib/router/router.ts:47:  "grilles",
ui/src/lib/router/router.ts:55:  "carte-opportunites",
ui/src/lib/router/router.ts:64:  // Hash attendu : `#/signaux`, `#/opportunity`, etc.
ui/src/lib/router/geo-route.ts:8:export type GeoSelectionKind = "municipality" | "signal" | "zone" | "lot";
ui/src/lib/router/geo-route.test.ts:116:      "?mode=data&selected=lot%3A4+516%3A943&selected=zone%3Afallback%3Aplaisance&focused=zone%3Afallback%3Aplaisance&filter.severity=high&filter.severity=medium&filter.source=pv&viewport=-73.800001%2C45.316667%2C12.5%2C0%2C45&panel=evidence&panel=lots",
ui/src/lib/scoring/grilles-data.test.ts:2:import { toGrilleRows } from "./grilles-data.js";
ui/src/lib/scoring/grilles-data.test.ts:4:describe("grille presentation", () => {
ui/src/lib/components/reconciliation/MrcGraphView.svelte:140:  // ── Positionnement des nœuds (grille par type — identique à CityGraphView) ─
ui/src/lib/components/reconciliation/CityGraphView.svelte:8:   * Layout : les nœuds sont répartis en rangées par type de nœud (grille par
ui/src/lib/components/reconciliation/CityGraphView.svelte:112:  // ── Positionnement des nœuds (grille par type) ───────────────────────────
ui/src/lib/components/reconciliation/CityGraphView.test.ts:8: *   2. Node positioning helpers (layout grille par type)
ui/src/lib/components/reconciliation/CityGraphView.test.ts:119:// ── 2. Helpers de positionnement (grille par type) ────────────────────────────
ui/src/lib/components/scoring/ScoreHover.svelte:3:  import type { GrilleRow } from "$lib/scoring/grilles-data.js";
ui/src/lib/components/scoring/GrillesView.test.ts:2:import { toGrilleRows } from "$lib/scoring/grilles-data.js";
ui/src/lib/components/scoring/GrillesView.svelte:9:  import { toGrilleRows } from "$lib/scoring/grilles-data.js";
ui/src/lib/components/scoring/GrillesView.svelte:14:  type ScoreTypeId = "signal" | "opportunite";
ui/src/lib/components/scoring/GrillesView.svelte:24:      id: "opportunite",
ui/src/lib/components/scoring/GrillesView.svelte:25:      label: "Score d'opportunité (/100)",
ui/src/lib/components/scoring/GrillesView.svelte:27:        "Score composite /100 d'une opportunité foncière, agrégé sur cinq axes pondérés (0 à 5 par axe). Un axe non disponible renormalise le score et plafonne la recommandation à « qualifier avec expert ». Référence : PROCESS.md Étape 5.",
ui/src/lib/components/scoring/GrillesView.svelte:42:    { type: "grid-cos-modification", label: "Modification de grille", value: SIGNAL_TYPE_VALUES["grid-cos-modification"] },
ui/src/lib/components/scoring/GrillesView.svelte:47:  const grilleRows = toGrilleRows();
ui/src/lib/components/scoring/GrillesView.svelte:55:  let editableLevels: Record<AxisT, LevelMap> = grilleRows.reduce(
ui/src/lib/components/scoring/GrillesView.svelte:151:        Le modele utilise deux mesures distinctes : le tri de signal (/10, par type) et le score d'opportunite (/100, composite multi-axes). Elles ne sont jamais combinées.
ui/src/lib/components/scoring/GrillesView.svelte:230:    <!-- ═══ TYPE B : Score d'opportunite (/100) ════════════════════════════ -->
ui/src/lib/components/scoring/GrillesView.svelte:231:    {#if activeScoreType === "opportunite"}
ui/src/lib/components/scoring/GrillesView.svelte:235:          title="Score d'opportunite : 5 axes ponderes (total /100)"
ui/src/lib/components/scoring/GrillesView.svelte:245:          {#each grilleRows as row}
ui/src/lib/components/scoring/GrillesView.svelte:254:          {#each grilleRows as row, i}
ui/src/lib/components/scoring/GrillesView.svelte:271:        Chaque opportunite est notee de <strong>0 a 5</strong> sur cinq axes ponderes (total /100).
ui/src/lib/components/scoring/GrillesView.svelte:282:          message="Les libellés des niveaux 0 à 5 peuvent être ajustés ici pour calibrer la grille. Les modifications restent dans cette session et ne sont pas enregistrées côté serveur."
ui/src/lib/components/scoring/GrillesView.svelte:288:        {#each grilleRows as row}
ui/src/lib/components/scoring/GrillesView.svelte:324:                    <label class="sr-only" for={`grille-${row.axis}-${lvl}`}>
ui/src/lib/components/scoring/GrillesView.svelte:328:                      id={`grille-${row.axis}-${lvl}`}
ui/src/lib/components/scoring/GrillesView.svelte:397:                      {@const gridRow = grilleRows.find((r) => r.axis === axis)}
ui/src/lib/components/TopNav.svelte:46:    { value: "grilles", label: "Grilles", icon: SlidersHorizontal },
ui/src/lib/components/RadarChatPanel.svelte:46:    "Top opportunités ?",
ui/src/lib/components/RadarChatPanel.svelte:124:      "chat.context.chip.opportunite": "Opportunite",
ui/src/lib/components/RadarChatPanel.svelte:402:          Posez une question sur les signaux, les opportunites ou les
ui/src/lib/components/signals/SignalRow.svelte:21:    "grid-cos-modification": "Modification grille/COS",
ui/src/lib/components/signals/SignalRow.svelte:68:   * Pourquoi ce type a cette valeur selon la grille VISION.
ui/src/lib/components/signals/SignalRow.svelte:76:    "grid-cos-modification": "Modification grille/COS = valeur 6/10 : ajustement des paramètres constructifs (coefficients d'occupation du sol, marges, hauteurs) sans nécessairement changer la vocation de zone.",
ui/src/lib/components/signals/SignalRow.svelte:116:  // Nombre d'opportunités attachées (compte les dossiers dont signalId = signal.id)
ui/src/lib/components/signals/SignalRow.svelte:149:            Modification grille/<Acronym term="COS" />
ui/src/lib/components/signals/SignalRow.svelte:252:          {" "}opportunité{nbOpportunites !== 1 ? "s" : ""} attachée{nbOpportunites !== 1 ? "s" : ""}
ui/src/lib/components/signals/SignalsT1View.svelte:49:  $: sortKey = (sortMode === "vision" ? "vision-priority" : "value") as SortKey;
ui/src/lib/components/signals/SignalsT1View.svelte:139:                    à 2 (PPCMOI) à 3 (plan d'urb.) à 4 (CPTAQ / grille).
ui/src/lib/components/signals/SignalsT1View.svelte:188:        <span class="font-semibold text-slate-800">score d'opportunité (/100)</span>.
ui/src/lib/components/signals/signals-t1.test.ts:114:  it("sort by vision-priority desc: residential-rezoning (rang VISION 1) en premier", () => {
ui/src/lib/components/signals/signals-t1.test.ts:115:    const sorted = sortSignals(testSignals, "vision-priority", "desc");
ui/src/lib/components/ciblage/CiblageView.svelte:212:        <code class="rounded bg-slate-100 px-1 text-xs">prioritySources</code>, et
ui/src/lib/components/ciblage/CiblageView.svelte:311:              Sources (catalogue prioritySources)
ui/src/lib/components/console/console-view.test.ts:90:  it("first row is build-now (highest-priority group)", () => {
ui/src/lib/components/maps/LotFichePanel.svelte:24:   *   /api/geo/:city/lots actuellement (ni zone code ni lien grille PDF).
ui/src/lib/components/maps/LotFichePanel.svelte:309:            Le lien grille PDF sera affiché ici lorsque disponible (artefact source A2/B2).
ui/src/lib/components/maps/SignauxSelPanel.svelte:6:   * selected entities: cities, graph signals, zones and lots.
ui/src/lib/components/maps/SignauxSelPanel.svelte:90:  // ── #4 — Filtrage zones/lots selon filtre actif ────────────────────────────
ui/src/lib/components/maps/SignauxSelPanel.svelte:152:  function safeKey(kind: "municipality" | "signal" | "zone" | "lot", id: string): SelectionKey | null {
ui/src/lib/components/maps/SignauxSelPanel.svelte:244:    return ref.title ?? ref.sourceUrl ?? ref.rawRef ?? ref.docSha;
ui/src/lib/components/maps/SignauxSelPanel.svelte:291:      evidence.rawRef !== null ||
ui/src/lib/components/maps/SignauxSelPanel.svelte:523:                          class:entity-meta-val--missing={!formatBbox(evidence.bbox)}
ui/src/lib/components/maps/SignauxSelPanel.svelte:524:                          title={formatBbox(evidence.bbox) ?? undefined}
ui/src/lib/components/maps/SignauxSelPanel.svelte:526:                          {formatBbox(evidence.bbox) ?? "non disponible"}
ui/src/lib/components/maps/SignauxSelPanel.svelte:599:              <span>Chargement zones/lots…</span>
ui/src/lib/components/maps/SignauxSelPanel.svelte:608:            {#if zonesResponse?.warnings.includes("lot-union-fallback-is-visual-only")}
ui/src/lib/components/maps/SignauxSelPanel.svelte:609:              <p class="sel-warning">Fallback visuel : les zones sont dérivées de groupes de lots.</p>
ui/src/lib/components/maps/SignauxSelPanel.svelte:641:                        <span class="entity-meta-val">{zone.properties.lotCount}</span>
ui/src/lib/components/maps/SignauxSelPanel.svelte:662:              <span>Chargement zones/lots…</span>
ui/src/lib/components/maps/EvaluationMapView.test.ts:64:    rawRef: sourceRef,
ui/src/lib/components/maps/EvaluationMapView.test.ts:69:    bbox: null,
ui/src/lib/components/maps/EvaluationMapView.test.ts:77:        rawRef: sourceRef,
ui/src/lib/components/maps/EvaluationMapView.test.ts:80:        bbox: null,
ui/src/lib/components/maps/EvaluationMapView.test.ts:90:      missing: ["description", "citation", "documentDate", "page", "bbox"],
ui/src/lib/components/maps/EvaluationMapView.test.ts:269:  it("le lien zonage→lots : zoneRefs du signal associées aux lots de la ville", async () => {
ui/src/lib/components/maps/EvaluationMapView.test.ts:407:function projX(lon: number, bbox: SvgBbox, svgW: number): number {
ui/src/lib/components/maps/EvaluationMapView.test.ts:408:  return ((lon - bbox.minLon) / (bbox.maxLon - bbox.minLon)) * svgW;
ui/src/lib/components/maps/EvaluationMapView.test.ts:411:function projY(lat: number, bbox: SvgBbox, svgH: number): number {
ui/src/lib/components/maps/EvaluationMapView.test.ts:412:  return ((bbox.maxLat - lat) / (bbox.maxLat - bbox.minLat)) * svgH;
ui/src/lib/components/maps/EvaluationMapView.test.ts:444:    const bbox = computeLotsBbox([]);
ui/src/lib/components/maps/EvaluationMapView.test.ts:445:    expect(bbox.minLon).toBeLessThan(-74);
ui/src/lib/components/maps/EvaluationMapView.test.ts:446:    expect(bbox.maxLon).toBeGreaterThan(-74);
ui/src/lib/components/maps/EvaluationMapView.test.ts:450:    const bbox = computeLotsBbox(VALLEYFIELD_FC.features);
ui/src/lib/components/maps/EvaluationMapView.test.ts:451:    expect(bbox.minLon).toBeLessThan(-74.12);
ui/src/lib/components/maps/EvaluationMapView.test.ts:452:    expect(bbox.maxLon).toBeGreaterThan(-74.115);
ui/src/lib/components/maps/EvaluationMapView.test.ts:453:    expect(bbox.minLat).toBeLessThan(45.27);
ui/src/lib/components/maps/EvaluationMapView.test.ts:454:    expect(bbox.maxLat).toBeGreaterThan(45.275);
ui/src/lib/components/maps/EvaluationMapView.test.ts:457:  it("projX → x dans [0, SVG_W] pour des coords dans la bbox", () => {
ui/src/lib/components/maps/EvaluationMapView.test.ts:458:    const bbox = computeLotsBbox(VALLEYFIELD_FC.features);
ui/src/lib/components/maps/EvaluationMapView.test.ts:459:    const x = projX(-74.117, bbox, SVG_W);
ui/src/lib/components/maps/EvaluationMapView.test.ts:464:  it("projY → y dans [0, SVG_H] pour des coords dans la bbox (Y inversé)", () => {
ui/src/lib/components/maps/EvaluationMapView.test.ts:465:    const bbox = computeLotsBbox(VALLEYFIELD_FC.features);
ui/src/lib/components/maps/EvaluationMapView.test.ts:466:    const y = projY(45.272, bbox, SVG_H);
ui/src/lib/components/maps/EvaluationMapView.test.ts:472:    const bbox: SvgBbox = { minLon: -74.2, minLat: 45.2, maxLon: -73.4, maxLat: 45.6 };
ui/src/lib/components/maps/EvaluationMapView.test.ts:473:    expect(projX(-74.2, bbox, SVG_W)).toBeCloseTo(0, 0);
ui/src/lib/components/maps/EvaluationMapView.test.ts:474:    expect(projX(-73.4, bbox, SVG_W)).toBeCloseTo(SVG_W, 0);
ui/src/lib/components/maps/EvaluationMapView.test.ts:478:    const bbox: SvgBbox = { minLon: -74.2, minLat: 45.2, maxLon: -73.4, maxLat: 45.6 };
ui/src/lib/components/maps/EvaluationMapView.test.ts:479:    expect(projY(45.6, bbox, SVG_H)).toBeCloseTo(0, 0);
ui/src/lib/components/maps/EvaluationMapView.test.ts:480:    expect(projY(45.2, bbox, SVG_H)).toBeCloseTo(SVG_H, 0);
ui/src/lib/components/maps/OpportunitesMapView.svelte:6:   * (données réelles : GET /api/opportunites), triés par score décroissant.
ui/src/lib/components/maps/OpportunitesMapView.svelte:8:   * Chaque opportunité montre :
ui/src/lib/components/maps/OpportunitesMapView.svelte:28:  } from "$lib/opportunites/opportunites-client.js";
ui/src/lib/components/maps/OpportunitesMapView.svelte:134:        opportunité{items.length !== 1 ? "s" : ""} ·
ui/src/lib/components/maps/OpportunitesMapView.svelte:146:          { cls: "bg-teal-500", label: "≥ 70 — forte opportunité" },
ui/src/lib/components/maps/OpportunitesMapView.svelte:174:  <!-- ── Main: classement des opportunités ─────────────────────────────────── -->
ui/src/lib/components/maps/OpportunitesMapView.svelte:180:        <span class="text-sm">Chargement des opportunités…</span>
ui/src/lib/components/maps/OpportunitesMapView.svelte:193:        title="Aucune opportunité disponible."
ui/src/lib/components/maps/OpportunitesMapView.svelte:194:        message="Les opportunités sont dérivées des DesignationEvent de l'état projet ontologie. Aucun état projet n'a encore été généré pour les villes du périmètre."
ui/src/lib/components/maps/OpportunitesMapView.svelte:202:          Top opportunités — {items.length} changement{items.length !== 1 ? "s" : ""} de zonage scorés
ui/src/lib/components/maps/OpportunitesMapView.svelte:207:      <ul class="space-y-2" aria-label="Classement des opportunités par score">
ui/src/lib/components/maps/SignauxSelPanel.test.ts:27:    priorityRank: 12,
ui/src/lib/components/maps/SignalPdfOverlay.svelte:9:  export let rawRef: string | null = null;
ui/src/lib/components/maps/SignalPdfOverlay.svelte:13:  export let bbox: [number, number, number, number] | null = null;
ui/src/lib/components/maps/SignalPdfOverlay.svelte:26:    const path = `/api/documents/raw?rawRef=${encodeURIComponent(ref)}`;
ui/src/lib/components/maps/SignalPdfOverlay.svelte:30:  // (via rawRef) au `sourceUrl` public. pdf.js récupère les octets par fetch/XHR :
ui/src/lib/components/maps/SignalPdfOverlay.svelte:38:    (rawRef ? rawDocumentUrl(rawRef) : null) ?? sourceUrl;
ui/src/lib/components/maps/SignalPdfOverlay.svelte:39:  $: fallbackRef = rawRef ?? rawObjectKey ?? sourceRef;
ui/src/lib/components/maps/SignalPdfOverlay.svelte:40:  $: isPdfSource = looksLikePdf(resolvedSourceUrl, rawRef, sourceRef);
ui/src/lib/components/maps/SignalPdfOverlay.svelte:126:      if (bbox && currentPage === (page ?? currentPage)) {
ui/src/lib/components/maps/SignalPdfOverlay.svelte:127:        // bbox fourni en fractions [x0, y0, x1, y1] de la page → rectangle.
ui/src/lib/components/maps/SignalPdfOverlay.svelte:136:    if (!bbox) return;
ui/src/lib/components/maps/SignalPdfOverlay.svelte:137:    const [x0, y0, x1, y1] = bbox;
ui/src/lib/components/maps/SignauxMapView.svelte:649:   * Ville → désélectionner les zones/lots mais conserver la ville sélectionnée
ui/src/lib/components/maps/SignauxMapView.svelte:676:      // Effacer toutes les sélections zone/lot, conserver la ville
ui/src/lib/components/maps/SignauxMapView.svelte:695:    // pour la cohérence carte (opacité zones/lots), mais ne pilote pas le détail.
ui/src/lib/components/maps/SignauxMapView.svelte:961:          "line-color": "#334155",
ui/src/lib/components/maps/SignauxMapView.svelte:981:    const [zonesResult, lotsResult] = await Promise.allSettled([
ui/src/lib/components/maps/SignauxMapView.svelte:1036:    // 2.4 — Ville sans zones configurées → bascule par défaut sur le 1er lot.
ui/src/lib/components/maps/SignauxMapView.svelte:1148:            <p class="m-0 font-semibold text-slate-500">Chargement zones/lots…</p>
ui/src/lib/components/maps/SignauxMapView.svelte:1170:        rawRef={activeEvidence.evidence.rawRef}
ui/src/lib/components/maps/SignauxMapView.svelte:1174:        bbox={activeEvidence.evidence.bbox}
ui/src/lib/components/maps/EvaluationMapView.svelte:3:   * EvaluationMapView — Vue Évaluation (maille zone/lots) — WP B slice-2.
ui/src/lib/components/maps/EvaluationMapView.svelte:5:   * Drilldown zone→lot : sélection d'une ville (parmi celles avec source lots
ui/src/lib/components/maps/EvaluationMapView.svelte:102:  // ── Données signaux (section grille — signaux réels depuis l'API) ─────────
ui/src/lib/components/maps/EvaluationMapView.svelte:322:  function projX(lon: number, bbox: SvgBbox): number {
ui/src/lib/components/maps/EvaluationMapView.svelte:323:    return ((lon - bbox.minLon) / (bbox.maxLon - bbox.minLon)) * SVG_W;
ui/src/lib/components/maps/EvaluationMapView.svelte:326:  function projY(lat: number, bbox: SvgBbox): number {
ui/src/lib/components/maps/EvaluationMapView.svelte:327:    return ((bbox.maxLat - lat) / (bbox.maxLat - bbox.minLat)) * SVG_H;
ui/src/lib/components/maps/EvaluationMapView.svelte:330:  function ringToPoints(ring: number[][], bbox: SvgBbox): string {
ui/src/lib/components/maps/EvaluationMapView.svelte:332:      .map((pt) => `${projX(pt[0], bbox).toFixed(2)},${projY(pt[1], bbox).toFixed(2)}`)
ui/src/lib/components/maps/EvaluationMapView.svelte:587:  <!-- ── Main: panneau côte à côte zonage + lots + grille signal ───────────── -->
ui/src/lib/components/maps/EvaluationMapView.svelte:851:    <!-- ─── Section grille d'évaluation signal ─────────────────────────────── -->
ui/src/lib/components/maps/signaux-sel-panel-preuve.test.ts:37:  rawRef?: string;
ui/src/lib/components/maps/signaux-sel-panel-preuve.test.ts:45:      rawRef: params.rawRef ?? null,
ui/src/lib/components/maps/signaux-sel-panel-preuve.test.ts:57:    evidence.rawRef !== null ||
ui/src/lib/components/maps/signaux-sel-panel-preuve.test.ts:115:  it("hasSourceEvidence est true quand rawRef est présent", () => {
ui/src/lib/components/maps/signaux-sel-panel-preuve.test.ts:117:      rawRef: "raw/proces-verbaux-saint-constant/2026/05/19/abc123.txt",
ui/src/lib/components/maps/signaux-sel-panel-preuve.test.ts:169:      rawRef: "raw/saint-constant/2026/05/pv.txt",
ui/src/lib/components/maps/signaux-sel-panel-preuve.test.ts:177:    expect(capturedPayload!.evidence.rawRef).toContain("saint-constant");
ui/src/lib/components/maps/DocumentOverlay.svelte:16:    return ref.title ?? ref.sourceUrl ?? ref.rawRef ?? ref.docSha;
ui/src/lib/components/geo/geo-client.ts:5: * GET /api/geo/features/:city → FeatureCollection fusionnée zones+lots+opps
ui/src/lib/components/geo/geo-client.ts:47:  opportuniteCount: number;
ui/src/lib/components/geo/geo-client.ts:50:  opportunites: GeoFeatureCollection;
ui/src/lib/components/geo/GeoView.svelte:5:   * Affiche les zones de zonage + lots + opportunités sur une carte GeoMap
ui/src/lib/components/geo/GeoView.svelte:9:   * GeoMap reçoit une FeatureCollection unifiée (zones + lots + opportunités).
ui/src/lib/components/geo/GeoView.svelte:83:      oppsCount = res.opportuniteCount;
ui/src/lib/components/geo/GeoView.svelte:86:      // GeoMap rend polygones (zones/lots) + points (opportunités) dans la même couche
ui/src/lib/components/geo/GeoView.svelte:90:        ...res.opportunites.features,
ui/src/lib/components/geo/GeoView.svelte:119:    } else if (kind === "opportunite" || kind === "signal") {
ui/src/lib/components/geo/GeoView.svelte:151:    if (kind === "opportunite" || kind === "signal") return "Opportunité";
ui/src/lib/components/geo/GeoView.svelte:226:          {#if zonesCount === 0 && lotsCount === 0 && oppsCount === 0}
ui/src/lib/components/geo/GeoView.svelte:275:              Les zones et lots seront affichés dès que le pipeline
ui/src/lib/components/geo/GeoView.svelte:281:              pour afficher les zones, lots et opportunités.
ui/src/lib/components/geo/GeoView.svelte:298:          labelFr="Carte des zones, lots et opportunités"
ui/src/lib/components/geo/GeoView.svelte:304:      {#if selectedCity && !dataLoading && zonesCount === 0 && lotsCount === 0 && oppsCount === 0 && !dataError}
ui/src/lib/components/source-review/SourceDeepDive.svelte:31:      detail: "Detection avant que l'opportunite soit evidente.",
ui/src/lib/components/opportunity/PhaseColumn.svelte:4:  import type { PhaseGroup } from "$lib/opportunites/funnel.js";
ui/src/lib/components/opportunity/opportunity-funnel.test.ts:4:import { groupEvidenceByPhase, PHASE_ORDER, axesForMode } from "$lib/opportunites/funnel.js";
ui/src/lib/components/opportunity/DossierCard.svelte:6:  import { toGrilleRows } from "$lib/scoring/grilles-data.js";
ui/src/lib/components/opportunity/DossierCard.svelte:9:  import { groupEvidenceByPhase, deriveTimeline, applyMode, axesForMode, isHypothesisAxis } from "$lib/opportunites/funnel.js";
ui/src/lib/components/opportunity/DossierCard.svelte:15:  const grilleRows = toGrilleRows();
ui/src/lib/components/opportunity/DossierCard.svelte:78:  <!-- ── En-tête du panneau de détail : fil d'ariane + titre de l'opportunité sélectionnée ── -->
ui/src/lib/components/opportunity/DossierCard.svelte:166:          {@const gridRow = grilleRows.find((r) => r.axis === axis)}
ui/src/lib/components/opportunity/OpportunityFunnel.svelte:8:  import { filterDossiersBySignalId, axesForMode } from "$lib/opportunites/funnel.js";
ui/src/lib/components/opportunity/OpportunityFunnel.svelte:79:  <!-- ── Bande laterale gauche : liste maitre des opportunites ──────────── -->
ui/src/lib/components/opportunity/OpportunityFunnel.svelte:178:        {selectedDossier ? selectedDossier.title : "Dossiers d'opportunité foncière"}
ui/src/lib/components/opportunity/OpportunityFunnel.svelte:182:          {selectedDossier.address} · Dossier d'opportunité foncière, entonnoir PROCESS 6 phases, preuves tracées.
ui/src/lib/components/opportunity/OpportunityFunnel.svelte:190:        message="Aucun dossier d'opportunité ne correspond au signal sélectionné pour l'instant."
ui/src/lib/signals/graph-signal-detail-client.test.ts:55:    expect(result[0].rawRef).toBeUndefined();
ui/src/lib/signals/graph-signal-detail-client.test.ts:58:  it("extracts a saints-anges-style ref (page + rawRef + excerpt, no sourceUrl)", () => {
ui/src/lib/signals/graph-signal-detail-client.test.ts:64:          rawRef: "/tmp/scw-docs/raw/proces-verbaux-saints-anges/cas/a74652366eeffeea.pdf",
ui/src/lib/signals/graph-signal-detail-client.test.ts:73:        rawRef: "raw/proces-verbaux-saints-anges/cas/a74652366eeffeea.pdf",
ui/src/lib/signals/graph-signal-detail-client.test.ts:75:          "/api/documents/raw?rawRef=raw%2Fproces-verbaux-saints-anges%2Fcas%2Fa74652366eeffeea.pdf",
ui/src/lib/signals/graph-signal-detail-client.test.ts:97:        rawRef: "a74652366eeffeea.pdf",
ui/src/lib/signals/graph-signal-detail-client.test.ts:133:          documentUrl: "/api/documents/raw?rawRef=raw%2Fpv.pdf",
ui/src/lib/signals/graph-signal-detail-client.test.ts:145:        documentUrl: "/api/documents/raw?rawRef=raw%2Fpv.pdf",
ui/src/lib/signals/graph-signal-detail-client.test.ts:156:      refs: [{ documentUrl: "/api/documents/raw?rawRef=raw%2Fpv.pdf" }],
ui/src/lib/signals/graph-signal-detail-client.test.ts:161:        docSha: "/api/documents/raw?rawRef=raw%2Fpv.pdf",
ui/src/lib/signals/graph-signal-detail-client.test.ts:162:        documentUrl: "/api/documents/raw?rawRef=raw%2Fpv.pdf",
ui/src/lib/signals/graph-signal-detail-client.test.ts:182:  it("extracts bbox when available", () => {
ui/src/lib/signals/graph-signal-detail-client.test.ts:188:          bbox: [0.12, 0.34, 0.56, 0.78],
ui/src/lib/signals/graph-signal-detail-client.test.ts:196:        bbox: [0.12, 0.34, 0.56, 0.78],
ui/src/lib/signals/graph-signal-detail-client.test.ts:222:            bbox: [0.1, 0.2, 0.3, 0.4],
ui/src/lib/signals/graph-signal-detail-client.test.ts:233:    expect(evidence.bbox).toEqual([0.1, 0.2, 0.3, 0.4]);
ui/src/lib/signals/graph-signal-detail-client.test.ts:237:  it("marks missing citation/page/bbox explicitly for legacy sourceRef-only nodes", () => {
ui/src/lib/signals/graph-signal-detail-client.test.ts:248:    expect(evidence.rawRef).toBe("raw/proces-verbaux-ville/cas/abc.txt");
ui/src/lib/signals/graph-signal-detail-client.test.ts:254:    expect(evidence.completeness.missing).toContain("bbox");
ui/src/lib/signals/graph-signal-detail-client.ts:16:  | "bbox";
ui/src/lib/signals/graph-signal-detail-client.ts:40:  rawRef?: string;
ui/src/lib/signals/graph-signal-detail-client.ts:46:  bbox?: unknown;

## Fichiers candidats
api/src/routes/geo-features.test.ts
api/src/routes/geo-features.ts
api/src/routes/geo-lots.test.ts
api/src/routes/geo-lots.ts
api/src/routes/geo-zones.test.ts
api/src/routes/geo-zones.ts
api/src/routes/graph-signals.test.ts
api/src/routes/graph-signals.ts
api/src/routes/opportunites.test.ts
api/src/routes/opportunites.ts
api/src/routes/signals-detail.test.ts
api/src/routes/signals-detail.ts
api/src/scripts/populate-geo.ts
api/src/scripts/pull-geo-ogc.ts
api/src/services/exploitation/signals.test.ts
api/src/services/exploitation/signals.ts
api/src/services/geo/extract-refs.test.ts
api/src/services/geo/extract-refs.ts
api/src/services/geo/fixtures/simulation/candiac.json
api/src/services/geo/fixtures/simulation/delson.json
api/src/services/geo/fixtures/simulation/saint-constant.json
api/src/services/geo/fixtures/simulation/sainte-catherine.json
api/src/services/geo/fixtures/simulation/sainte-catherine-zones.json
api/src/services/geo/geo-features.ts
api/src/services/geo/lots.test.ts
api/src/services/geo/lots.ts
api/src/services/geo/match-refs.test.ts
api/src/services/geo/match-refs.ts
api/src/services/geo/measure-geo-mapping.ts
api/src/services/geo/ogc-pull.test.ts
api/src/services/geo/ogc-pull.ts
api/src/services/geo/populate-geo.test.ts
api/src/services/geo/populate-geo.ts
api/src/services/geo/priority-resolver.test.ts
api/src/services/geo/priority-resolver.ts
api/src/services/geo/resolve-refs.test.ts
api/src/services/geo/resolve-refs.ts
api/src/services/geo/run-geo-mapper.ts
api/src/services/geo/simulation/simulation-provider.test.ts
api/src/services/geo/simulation/simulation-provider.ts
api/src/services/geo/simulation/types.ts
api/src/services/geo/simulation/zone-kind.ts
api/src/services/geo/zone-provider-db.test.ts
api/src/services/geo/zone-provider-db.ts
api/src/services/geo/zones.test.ts
api/src/services/geo/zones.ts
api/src/services/opportunity/scoring.test.ts
api/src/services/opportunity/scoring.ts
api/src/services/opportunity/valleyfield-dossiers.test.ts
api/src/services/opportunity/valleyfield-dossiers.ts
api/src/services/scoring/lot-potential.test.ts
api/src/services/scoring/lot-potential.ts
packages/radar-domain/src/geo/geo-category-mapping.ts
packages/radar-domain/src/schemas/ontology/geo.ts
packages/radar-domain/src/schemas/opportunity-fiche.v1.ts
packages/radar-domain/src/schemas/opportunity.test.ts
packages/radar-domain/src/schemas/opportunity.ts
packages/radar-domain/src/schemas/signal-payload.v1.ts
packages/radar-domain/src/schemas/signal.test.ts
packages/radar-domain/src/schemas/signal.ts
packages/radar-sources/src/geo/geo-fetch-utils.ts
packages/radar-sources/src/geo/geo-source-inventory.data.ts
packages/radar-sources/src/geo/geo-source-inventory.test.ts
packages/radar-sources/src/geo/geo-source-inventory.ts
packages/radar-sources/src/geo/geo-vertical-priority.ts
packages/radar-sources/src/geo/municipalities.qc.json
packages/radar-sources/src/sources/pdf-ocr.test.ts
packages/radar-sources/src/sources/pdf-ocr.ts
packages/radar-sources/src/sources/_spikes/adresses-quebec-igo-geocoder/README.md
packages/radar-sources/src/sources/_spikes/adresses-quebec-igo-geocoder/samples/terrapi-adresses-beauharnois.json
packages/radar-sources/src/sources/_spikes/adresses-quebec-igo-geocoder/samples/terrapi-adresses-salaberry.json
packages/radar-sources/src/sources/_spikes/adresses-quebec-igo-geocoder/samples/terrapi-municipalites-beauharnois.json
packages/radar-sources/src/sources/_spikes/avis-publics-beauharnois/samples/avis-pdf-urls.txt
packages/radar-sources/src/sources/_spikes/avis-publics-valleyfield/samples/avis-pdf-urls.txt
packages/radar-sources/src/sources/_spikes/bdzi-flood-zones/README.md
packages/radar-sources/src/sources/_spikes/cadastre-infolot/README.md
packages/radar-sources/src/sources/_spikes/contraintes-geo-valleyfield.md
packages/radar-sources/src/sources/_spikes/cptaq-zone-agricole/README.md
packages/radar-sources/src/sources/_spikes/cptaq-zone-agricole/samples/ckan-package-show-decisions-cptaq.json
packages/radar-sources/src/sources/_spikes/reglements-urbanisme-valleyfield/samples/reglement-450-02-pdf-urls.txt
packages/radar-sources/src/sources/_spikes/signal-marche-contexte-valleyfield.md
packages/radar-sources/src/sources/_spikes/zonage-plans-grilles-valleyfield/README.md
scripts/preuve.sh
ui/src/lib/components/geo/geo-categories.ts
ui/src/lib/components/geo/geo-client.ts
ui/src/lib/components/geo/GeoView.svelte
ui/src/lib/components/maps/LotFichePanel.svelte
ui/src/lib/components/maps/lot-fiche-utils.test.ts
ui/src/lib/components/maps/lot-fiche-utils.ts
ui/src/lib/components/maps/OpportunitesMapView.svelte
ui/src/lib/components/maps/SignalPdfOverlay.svelte
ui/src/lib/components/maps/signaux-sel-panel-preuve.test.ts
ui/src/lib/components/opportunity/DossierCard.svelte
ui/src/lib/components/opportunity/OpportunityFunnel.svelte
ui/src/lib/components/opportunity/opportunity-funnel.test.ts
ui/src/lib/components/opportunity/PhaseColumn.svelte
ui/src/lib/components/scoring/GrillesView.svelte
ui/src/lib/components/scoring/GrillesView.test.ts
ui/src/lib/components/signals/SignalRow.svelte
ui/src/lib/components/signals/signals-t1.test.ts
ui/src/lib/components/signals/SignalsT1View.svelte
ui/src/lib/demo/opportunity-dossiers.test.ts
ui/src/lib/maps/cadastre-geojson-source.test.ts
ui/src/lib/maps/cadastre-geojson-source.ts
ui/src/lib/maps/geo-level-navigation.ts
ui/src/lib/maps/geo-zones-client.ts
ui/src/lib/maps/lots-client.test.ts
ui/src/lib/maps/lots-client.ts
ui/src/lib/maps/signaux-map-geo.test.ts
ui/src/lib/maps/signaux-map-geo.ts
ui/src/lib/opportunites/funnel.test.ts
ui/src/lib/opportunites/funnel.ts
ui/src/lib/opportunites/opportunites-client.test.ts
ui/src/lib/opportunites/opportunites-client.ts
ui/src/lib/router/geo-route.test.ts
ui/src/lib/router/geo-route.ts
ui/src/lib/scoring/grilles-data.test.ts
ui/src/lib/scoring/grilles-data.ts
ui/src/lib/signals/feed.ts
ui/src/lib/signals/graph-signal-detail-client.test.ts
ui/src/lib/signals/graph-signal-detail-client.ts
ui/src/lib/signals/graph-signal-filter.test.ts
ui/src/lib/signals/graph-signal-filter.ts
ui/src/lib/signals/graph-signals-by-city-client.ts
ui/src/lib/signals/pdf-citation-match.test.ts
ui/src/lib/signals/pdf-citation-match.ts
ui/src/lib/signals/signal-detail-client.test.ts
ui/src/lib/signals/signal-detail-client.ts
ui/src/lib/signals/signals-by-city-client.test.ts
ui/src/lib/signals/signals-by-city-client.ts
ui/src/lib/signals/signals-live.test.ts
ui/src/lib/signals/signals-live.ts
