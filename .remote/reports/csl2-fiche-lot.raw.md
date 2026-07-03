# CS-L2 — fiche lot complète

## LotFiche/Evaluation excerpts
ui/src/app.css:2:   préconnexion + Google Fonts (variable weight 100–900) pour garantir que
ui/src/App.svelte:19:  import EvaluationMapView from "$lib/components/maps/EvaluationMapView.svelte";
ui/src/App.svelte:54:    "grid-cos-modification": "Modification grille/COS",
ui/src/App.svelte:187:      {:else if activeView === "evaluation"}
ui/src/App.svelte:188:        <!-- Vue Évaluation : fusion EvaluationMapView + GrillesView (carte cadastrale + grilles) -->
ui/src/App.svelte:189:        <EvaluationMapView />
ui/src/App.svelte:199:      {:else if activeView === "grilles"}
ui/src/App.svelte:215:      {:else if activeView === "carte-evaluation"}
ui/src/App.svelte:216:        <EvaluationMapView />
ui/src/lib/onboarding/onboarding-data.ts:3:  SourceEvaluation,
ui/src/lib/onboarding/onboarding-data.ts:5:} from "../source-review/source-evaluation-data";
ui/src/lib/onboarding/onboarding-data.ts:6:import { sourceEvaluations } from "../source-review/source-evaluation-data";
ui/src/lib/onboarding/onboarding-data.ts:8:export { sourceEvaluations };
ui/src/lib/onboarding/onboarding-data.ts:73:  "roles-evaluation-fonciere-mamh":
ui/src/lib/onboarding/onboarding-data.ts:87:  "zonage-plans-grilles-valleyfield":
ui/src/lib/onboarding/onboarding-data.ts:89:  "cadastre-infolot":
ui/src/lib/onboarding/onboarding-data.ts:138:  sources: SourceEvaluation[];
ui/src/lib/onboarding/onboarding-data.ts:142:  sources: SourceEvaluation[] = sourceEvaluations,
ui/src/lib/onboarding/onboarding-data.ts:144:  const map = new Map<RecommendationKind, SourceEvaluation[]>();
ui/src/lib/onboarding/onboarding-data.ts:171:  sources: SourceEvaluation[] = sourceEvaluations,
ui/src/lib/onboarding/onboarding-data.ts:187:  sources: SourceEvaluation[] = sourceEvaluations,
ui/src/lib/onboarding/onboarding-data.test.ts:2:import { sourceEvaluations } from "../source-review/source-evaluation-data";
ui/src/lib/onboarding/onboarding-data.test.ts:17:    expect(total).toBe(sourceEvaluations.length);
ui/src/lib/onboarding/onboarding-data.test.ts:43:    const subset = sourceEvaluations.filter((s) => s.recommendation === "build-now");
ui/src/lib/onboarding/onboarding-data.test.ts:58:    const byId = new Map(sourceEvaluations.map((s) => [s.id, s]));
ui/src/lib/onboarding/onboarding-data.test.ts:67:    const buildNow = sourceEvaluations.filter((s) => s.recommendation === "build-now");
ui/src/lib/onboarding/onboarding-data.test.ts:98:    const subset = sourceEvaluations.slice(0, 3);
ui/src/lib/router/router.ts:42:  "evaluation",
ui/src/lib/router/router.ts:47:  "grilles",
ui/src/lib/router/router.ts:56:  "carte-evaluation",
ui/src/lib/sources/contribution.test.ts:20:  it("le role foncier couvre les 3 dossiers (sourceId partagé)", () => {
ui/src/lib/sources/contribution.test.ts:22:    const role = contributions.find((c) => c.sourceId === "role-70052-2026");
ui/src/lib/sources/contribution.test.ts:23:    expect(role).toBeDefined();
ui/src/lib/sources/contribution.test.ts:24:    expect(role!.dossierCount).toBe(3);
ui/src/lib/sources/contribution.test.ts:25:    expect(role!.evidenceCount).toBe(3);
ui/src/lib/sources/contribution.test.ts:37:  it("le mix de verification de role-70052-2026 est uniquement 'fait'", () => {
ui/src/lib/sources/contribution.test.ts:39:    const role = contributions.find((c) => c.sourceId === "role-70052-2026");
ui/src/lib/sources/contribution.test.ts:40:    expect(role).toBeDefined();
ui/src/lib/sources/contribution.test.ts:41:    expect(role!.verificationMix.fait).toBe(3);
ui/src/lib/sources/contribution.test.ts:42:    expect(role!.verificationMix.hypothese).toBe(0);
ui/src/lib/sources/contribution.test.ts:43:    expect(role!.verificationMix["non-disponible"]).toBe(0);
ui/src/lib/jobs/pipeline-jobs.test.ts:28:        sourceId: "role-evaluation-mamh-70052",
ui/src/lib/jobs/jobs-data.ts:37:    sourceRef: "roles-evaluation-fonciere-mamh",
ui/src/lib/scoring/grilles-data.test.ts:2:import { toGrilleRows } from "./grilles-data.js";
ui/src/lib/scoring/grilles-data.test.ts:4:describe("grille presentation", () => {
ui/src/lib/components/onboarding/OnboardingView.svelte:14:  import type { RecommendationKind } from "$lib/source-review/source-evaluation-data.js";
ui/src/lib/components/coordination/CoordinationView.svelte:123:  function roleIcon(role: H2ARoleLabel): typeof User {
ui/src/lib/components/coordination/CoordinationView.svelte:124:    if (role === "PRINCIPAL") return User;
ui/src/lib/components/coordination/CoordinationView.svelte:125:    if (role === "CONDUCTOR") return Music2;
ui/src/lib/components/coordination/CoordinationView.svelte:129:  function roleTone(role: H2ARoleLabel): "neutral" | "info" | "success" {
ui/src/lib/components/coordination/CoordinationView.svelte:130:    if (role === "PRINCIPAL") return "success";
ui/src/lib/components/coordination/CoordinationView.svelte:131:    if (role === "CONDUCTOR") return "info";
ui/src/lib/components/coordination/CoordinationView.svelte:346:              {@const role = view.entry.actor.role}
ui/src/lib/components/coordination/CoordinationView.svelte:347:              {@const Icon = roleIcon(role)}
ui/src/lib/components/coordination/CoordinationView.svelte:352:                    <Badge tone={roleTone(role)}>{ROLE_LABELS_FR[role]}</Badge>
ui/src/lib/components/TopNav.test.ts:41:const MAIN_VIEWS = ["Signaux", "Évaluation", "Sources"] as const;
ui/src/lib/components/TopNav.test.ts:85:    expect(getByText("Évaluation").getAttribute("aria-current")).toBeNull();
ui/src/lib/components/TopNav.test.ts:89:  it("quand activeView=evaluation, Évaluation est actif et Signaux ne l'est pas", () => {
ui/src/lib/components/TopNav.test.ts:90:    const { getByText } = renderNav("evaluation");
ui/src/lib/components/TopNav.test.ts:91:    expect(getByText("Évaluation").getAttribute("aria-current")).toBe("page");
ui/src/lib/components/reconciliation/MrcGraphView.svelte:140:  // ── Positionnement des nœuds (grille par type — identique à CityGraphView) ─
ui/src/lib/components/reconciliation/MrcGraphView.svelte:234:      <div class="text-xs text-red-500" role="alert">{mrcsError}</div>
ui/src/lib/components/reconciliation/MrcGraphView.svelte:325:          role="img"
ui/src/lib/components/reconciliation/MrcGraphView.svelte:390:              role="button"
ui/src/lib/components/reconciliation/CityGraphView.svelte:8:   * Layout : les nœuds sont répartis en rangées par type de nœud (grille par
ui/src/lib/components/reconciliation/CityGraphView.svelte:17:   * SignauxMapView / EvaluationMapView).
ui/src/lib/components/reconciliation/CityGraphView.svelte:112:  // ── Positionnement des nœuds (grille par type) ───────────────────────────
ui/src/lib/components/reconciliation/CityGraphView.svelte:247:          role="img"
ui/src/lib/components/reconciliation/CityGraphView.svelte:313:              role="button"
ui/src/lib/components/reconciliation/CityGraphView.test.ts:8: *   2. Node positioning helpers (layout grille par type)
ui/src/lib/components/reconciliation/CityGraphView.test.ts:119:// ── 2. Helpers de positionnement (grille par type) ────────────────────────────
ui/src/lib/components/scoring/ScoreHover.svelte:3:  import type { GrilleRow } from "$lib/scoring/grilles-data.js";
ui/src/lib/components/scoring/GrillesView.test.ts:2:import { toGrilleRows } from "$lib/scoring/grilles-data.js";
ui/src/lib/components/scoring/GrillesView.svelte:9:  import { toGrilleRows } from "$lib/scoring/grilles-data.js";
ui/src/lib/components/scoring/GrillesView.svelte:42:    { type: "grid-cos-modification", label: "Modification de grille", value: SIGNAL_TYPE_VALUES["grid-cos-modification"] },
ui/src/lib/components/scoring/GrillesView.svelte:47:  const grilleRows = toGrilleRows();
ui/src/lib/components/scoring/GrillesView.svelte:55:  let editableLevels: Record<AxisT, LevelMap> = grilleRows.reduce(
ui/src/lib/components/scoring/GrillesView.svelte:245:          {#each grilleRows as row}
ui/src/lib/components/scoring/GrillesView.svelte:254:          {#each grilleRows as row, i}
ui/src/lib/components/scoring/GrillesView.svelte:282:          message="Les libellés des niveaux 0 à 5 peuvent être ajustés ici pour calibrer la grille. Les modifications restent dans cette session et ne sont pas enregistrées côté serveur."
ui/src/lib/components/scoring/GrillesView.svelte:288:        {#each grilleRows as row}
ui/src/lib/components/scoring/GrillesView.svelte:324:                    <label class="sr-only" for={`grille-${row.axis}-${lvl}`}>
ui/src/lib/components/scoring/GrillesView.svelte:328:                      id={`grille-${row.axis}-${lvl}`}
ui/src/lib/components/scoring/GrillesView.svelte:397:                      {@const gridRow = grilleRows.find((r) => r.axis === axis)}
ui/src/lib/components/scoring/GrillesView.svelte:411:                              role="button"
ui/src/lib/components/TopNav.svelte:35:    { id: "evaluation", label: "Évaluation" },
ui/src/lib/components/TopNav.svelte:46:    { value: "grilles", label: "Grilles", icon: SlidersHorizontal },
ui/src/lib/components/ViewLayout.svelte:6:   *  - `controls` (optionnel) : bande laterale gauche (~w-72) pour les controles propres a la vue
ui/src/lib/components/ViewLayout.svelte:31:  /** Largeur CSS de la bande laterale de controles. Par defaut : w-72 (18rem). */
ui/src/lib/components/ViewLayout.svelte:60:      <!-- Layout avec bande laterale de controles -->
ui/src/lib/components/RadarChatPanel.svelte:168:        history.push({ role: "user", content: turn.content });
ui/src/lib/components/RadarChatPanel.svelte:172:        history.push({ role: "assistant", content: turn.finalContent });
ui/src/lib/components/RadarChatPanel.svelte:222:      const messages: ChatTurn[] = [...history, { role: "user", content }];
ui/src/lib/components/RadarChatPanel.svelte:428:                role="user"
ui/src/lib/components/RadarChatPanel.svelte:484:                    role="assistant"
ui/src/lib/components/signals/SignalRow.svelte:21:    "grid-cos-modification": "Modification grille/COS",
ui/src/lib/components/signals/SignalRow.svelte:68:   * Pourquoi ce type a cette valeur selon la grille VISION.
ui/src/lib/components/signals/SignalRow.svelte:76:    "grid-cos-modification": "Modification grille/COS = valeur 6/10 : ajustement des paramètres constructifs (coefficients d'occupation du sol, marges, hauteurs) sans nécessairement changer la vocation de zone.",
ui/src/lib/components/signals/SignalRow.svelte:149:            Modification grille/<Acronym term="COS" />
ui/src/lib/components/signals/SignalsT1View.svelte:132:                    La VISION numérote Priorité&nbsp;1 à 4, mais les notes /10 ne suivent pas cet ordre :
ui/src/lib/components/signals/SignalsT1View.svelte:139:                    à 2 (PPCMOI) à 3 (plan d'urb.) à 4 (CPTAQ / grille).
ui/src/lib/components/ciblage/CiblageView.svelte:387:            <label class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500" for="ciblage-notes">
ui/src/lib/components/ciblage/CiblageView.svelte:391:              id="ciblage-notes"
ui/src/lib/components/ciblage/CiblageView.svelte:394:              bind:value={form.notes}
ui/src/lib/components/ciblage/CiblageView.svelte:493:              {#if plan.notes}
ui/src/lib/components/ciblage/CiblageView.svelte:495:                  {plan.notes}
ui/src/lib/components/console/QualificationTab.svelte:3:  import type { SourceEvaluation, RecommendationKind } from "$lib/source-review/source-evaluation-data";
ui/src/lib/components/console/QualificationTab.svelte:6:  import { sourceEvaluations } from "$lib/source-review/source-evaluation-data.js";
ui/src/lib/components/console/QualificationTab.svelte:24:  function toggleSource(source: SourceEvaluation): void {
ui/src/lib/components/console/QualificationTab.svelte:66:    sources={sourceEvaluations}
ui/src/lib/components/console/QualificationTab.svelte:88:        Catalogue sources ({sourceEvaluations.length})
ui/src/lib/components/console/QualificationTab.svelte:96:      {#each sourceEvaluations as source (source.id)}
ui/src/lib/components/console/console-view.test.ts:8:import { sourceEvaluations } from "$lib/source-review/source-evaluation-data.js";
ui/src/lib/components/console/console-view.test.ts:72:    expect(total).toBe(sourceEvaluations.length);
ui/src/lib/components/console/console-view.test.ts:77:    const presentRecs = new Set(sourceEvaluations.map((s) => s.recommendation));
ui/src/lib/components/console/ConsoleView.svelte:23:      hint: "Évaluation et priorisation du catalogue de sources.",
ui/src/lib/components/console/DeepDiveTab.svelte:3:  import type { SourceEvaluation } from "$lib/source-review/source-evaluation-data";
ui/src/lib/components/console/DeepDiveTab.svelte:4:  import { sourceEvaluations } from "$lib/source-review/source-evaluation-data.js";
ui/src/lib/components/console/DeepDiveTab.svelte:15:  let expandedSourceId: string | null = sourceEvaluations[0]?.id ?? null;
ui/src/lib/components/console/DeepDiveTab.svelte:17:  function toggleSource(source: SourceEvaluation): void {
ui/src/lib/components/console/DeepDiveTab.svelte:44:      Approfondissement par source ({sourceEvaluations.length})
ui/src/lib/components/console/DeepDiveTab.svelte:52:      {#each sourceEvaluations as source (source.id)}
ui/src/lib/components/maps/lot-fiche-utils.ts:2: * Utilitaires purs pour LotFichePanel — CS-L2.
ui/src/lib/components/maps/lot-fiche-utils.ts:8: * (noLot, géométrie, score). Aucun nom de propriétaire ni PII n'est traité.
ui/src/lib/components/maps/lot-fiche-utils.ts:17: * Utilisé pour générer le lien Google Maps.
ui/src/lib/components/maps/lot-fiche-utils.ts:32:// ── Google Maps URL ────────────────────────────────────────────────────────────
ui/src/lib/components/maps/lot-fiche-utils.ts:35: * Construit le lien Google Maps depuis lat/lon.
ui/src/lib/components/maps/LotFichePanel.svelte:3:   * LotFichePanel — Fiche lot complète — CS-L2 (S-2).
ui/src/lib/components/maps/LotFichePanel.svelte:5:   * Affiche, au clic sur un lot dans la vue Évaluation, les données
ui/src/lib/components/maps/LotFichePanel.svelte:6:   * publiques du lot (cadastre + score de potentiel).
ui/src/lib/components/maps/LotFichePanel.svelte:9:   * - Cadastre : noLot (NO_LOT MRNF), superficieM2 (non disponible depuis MRNF
ui/src/lib/components/maps/LotFichePanel.svelte:12:   * - Lien Google Maps (lat/lon centroïde du lot)
ui/src/lib/components/maps/LotFichePanel.svelte:13:   * - Zone notes : placeholder CS-L3 (pas d'implémentation ici)
ui/src/lib/components/maps/LotFichePanel.svelte:16:   * Le cadastre allégé MRNF ne contient QUE le NO_LOT.
ui/src/lib/components/maps/LotFichePanel.svelte:21:   * - Rôle MAMH (usageCode, valeurs d'évaluation, densité) : nécessite
ui/src/lib/components/maps/LotFichePanel.svelte:22:   *   l'extraction rôle MAMH — non disponible dans le cadastre allégé MRNF.
ui/src/lib/components/maps/LotFichePanel.svelte:24:   *   /api/geo/:city/lots actuellement (ni zone code ni lien grille PDF).
ui/src/lib/components/maps/LotFichePanel.svelte:65:  $: noLot = lot?.properties.noLot ?? "";
ui/src/lib/components/maps/LotFichePanel.svelte:86:    const key = noLot && citySlug ? `${citySlug}::${noLot}` : "";
ui/src/lib/components/maps/LotFichePanel.svelte:89:      void loadProspectState(noLot, citySlug);
ui/src/lib/components/maps/LotFichePanel.svelte:99:  async function loadProspectState(noLotValue: string, citySlugValue: string): Promise<void> {
ui/src/lib/components/maps/LotFichePanel.svelte:103:      const state = await fetchProspectLotState(noLotValue, citySlugValue);
ui/src/lib/components/maps/LotFichePanel.svelte:104:      if (prospectRequestKey !== `${citySlugValue}::${noLotValue}`) return;
ui/src/lib/components/maps/LotFichePanel.svelte:106:      prospectNotes = state.notes;
ui/src/lib/components/maps/LotFichePanel.svelte:108:      if (prospectRequestKey !== `${citySlugValue}::${noLotValue}`) return;
ui/src/lib/components/maps/LotFichePanel.svelte:113:      if (prospectRequestKey === `${citySlugValue}::${noLotValue}`) {
ui/src/lib/components/maps/LotFichePanel.svelte:130:      title="Fiche lot {noLot}"
ui/src/lib/components/maps/LotFichePanel.svelte:141:            N° lot : <span class="font-mono font-semibold text-slate-900" data-testid="fiche-nolot-mobile">{noLot}</span>
ui/src/lib/components/maps/LotFichePanel.svelte:162:              aria-label="Ouvrir le lot {noLot} dans Google Maps (nouvelle fenêtre)"
ui/src/lib/components/maps/LotFichePanel.svelte:165:              Voir dans Google Maps
ui/src/lib/components/maps/LotFichePanel.svelte:180:    <div role="region" aria-label="Fiche du lot {noLot}">
ui/src/lib/components/maps/LotFichePanel.svelte:194:            {noLot}
ui/src/lib/components/maps/LotFichePanel.svelte:212:      <section aria-labelledby="section-cadastre">
ui/src/lib/components/maps/LotFichePanel.svelte:214:          id="section-cadastre"
ui/src/lib/components/maps/LotFichePanel.svelte:222:            {noLot}
ui/src/lib/components/maps/LotFichePanel.svelte:231:          <dd class="text-slate-400 italic text-xs">non disponible (cadastre allégé)</dd>
ui/src/lib/components/maps/LotFichePanel.svelte:273:      <section aria-labelledby="section-role">
ui/src/lib/components/maps/LotFichePanel.svelte:275:          id="section-role"
ui/src/lib/components/maps/LotFichePanel.svelte:278:          Rôle MAMH (évaluation foncière)
ui/src/lib/components/maps/LotFichePanel.svelte:282:          data-testid="fiche-role-na"
ui/src/lib/components/maps/LotFichePanel.svelte:309:            Le lien grille PDF sera affiché ici lorsque disponible (artefact source A2/B2).
ui/src/lib/components/maps/LotFichePanel.svelte:314:      <!-- Section Marquage équipe + notes (CS-L3) ─────────────────────────── -->
ui/src/lib/components/maps/LotFichePanel.svelte:315:      <section aria-labelledby="section-notes">
ui/src/lib/components/maps/LotFichePanel.svelte:317:          id="section-notes"
ui/src/lib/components/maps/LotFichePanel.svelte:321:          Marquage équipe & notes
ui/src/lib/components/maps/LotFichePanel.svelte:336:            Chargement des marques et notes…
ui/src/lib/components/maps/LotFichePanel.svelte:343:            Marquage/notes indisponibles — {prospectError}.
ui/src/lib/components/maps/LotFichePanel.svelte:362:              <ul class="space-y-1.5" aria-label="Dernières notes équipe">
ui/src/lib/components/maps/LotFichePanel.svelte:385:      <!-- Section Lien Google Maps ─────────────────────────────────────────── -->
ui/src/lib/components/maps/LotFichePanel.svelte:400:            aria-label="Ouvrir le lot {noLot} dans Google Maps (nouvelle fenêtre)"
ui/src/lib/components/maps/LotFichePanel.svelte:403:            Voir dans Google Maps
ui/src/lib/components/maps/lot-fiche-utils.test.ts:6: * ni à des données personnelles — uniquement noLot et géométrie publics.
ui/src/lib/components/maps/lot-fiche-utils.test.ts:21:  noLot: string,
ui/src/lib/components/maps/lot-fiche-utils.test.ts:30:    properties: { noLot, citySlug: "test-city" },
ui/src/lib/components/maps/lot-fiche-utils.test.ts:50:      properties: { noLot: "000001" },
ui/src/lib/components/maps/lot-fiche-utils.test.ts:59:      properties: { noLot: "000002" },
ui/src/lib/components/maps/lot-fiche-utils.test.ts:78:      properties: { noLot: "000004" },
ui/src/lib/components/maps/lot-fiche-utils.test.ts:95:  it("génère une URL Google Maps valide", () => {
ui/src/lib/components/maps/lot-fiche-utils.test.ts:194:      properties: { noLot: "999999" },
ui/src/lib/components/maps/lot-fiche-utils.test.ts:203:      properties: { noLot: "999998", potentialScore: 5 },
ui/src/lib/components/maps/SignauxSelPanel.svelte:109:    const noLots = new Set<string>();
ui/src/lib/components/maps/SignauxSelPanel.svelte:112:        noLots.add(ref);
ui/src/lib/components/maps/SignauxSelPanel.svelte:115:    return noLots.size > 0 ? noLots : null;
ui/src/lib/components/maps/SignauxSelPanel.svelte:124:  $: filteredLots = filteredLotNoSet ? lots.filter((l) => filteredLotNoSet!.has(l.properties.noLot)) : lots;
ui/src/lib/components/maps/SignauxSelPanel.svelte:171:    return safeKey("lot", `${citySlug}/${lot.properties.noLot}`);
ui/src/lib/components/maps/SignauxSelPanel.svelte:674:            {#each visibleLots as lot (lot.properties.noLot)}
ui/src/lib/components/maps/SignauxSelPanel.svelte:687:                    <span class="sel-entity-label">{lot.properties.noLot}</span>
ui/src/lib/components/maps/SignauxSelPanel.svelte:694:                        <code class="entity-meta-val">{lot.properties.noLot}</code>
ui/src/lib/components/maps/SignauxRail.svelte:337:        <ul class="rail-city-list" role="list">
ui/src/lib/components/maps/SignauxRail.svelte:404:                        <ul class="space-y-1" role="list">
ui/src/lib/components/maps/EvaluationMapView.test.ts:2: * Tests for EvaluationMapView — zonage relié aux lots cadastraux (WP B slice-2).
ui/src/lib/components/maps/EvaluationMapView.test.ts:11: *   4. SVG projection helpers (ported from EvaluationMapView script)
ui/src/lib/components/maps/EvaluationMapView.test.ts:27:function makeLotFeature(noLot: string, citySlug: string): LotFeature {
ui/src/lib/components/maps/EvaluationMapView.test.ts:42:    properties: { noLot, citySlug },
ui/src/lib/components/maps/EvaluationMapView.test.ts:132:describe("EvaluationMapView drilldown — lots-client integration", () => {
ui/src/lib/components/maps/EvaluationMapView.test.ts:183:describe("EvaluationMapView — signal-detail-client (changements de zonage)", () => {
ui/src/lib/components/maps/EvaluationMapView.test.ts:223:describe("EvaluationMapView — panneau zonage+lots (rendu combiné)", () => {
ui/src/lib/components/maps/EvaluationMapView.test.ts:439:describe("EvaluationMapView drilldown — SVG projection helpers", () => {
ui/src/lib/components/maps/EvaluationMapView.test.ts:486:describe("EvaluationMapView drilldown — anti-PII (Loi 25)", () => {
ui/src/lib/components/maps/EvaluationMapView.test.ts:487:  it("les properties de chaque lot ne contiennent que noLot et citySlug", async () => {
ui/src/lib/components/maps/EvaluationMapView.test.ts:498:        expect(["noLot", "citySlug"]).toContain(k);
ui/src/lib/components/maps/EvaluationMapView.test.ts:500:      // noLot doit être une chaîne non vide
ui/src/lib/components/maps/EvaluationMapView.test.ts:501:      expect(typeof f.properties.noLot).toBe("string");
ui/src/lib/components/maps/EvaluationMapView.test.ts:502:      expect(f.properties.noLot.length).toBeGreaterThan(0);
ui/src/lib/components/maps/EvaluationMapView.test.ts:506:  it("lots MRNF n'ont pas de champ owner, nom, adresse, évaluation foncière", async () => {
ui/src/lib/components/maps/EvaluationMapView.test.ts:518:      expect(f.properties).not.toHaveProperty("evaluation");
ui/src/lib/components/maps/EvaluationMapView.test.ts:540:describe("EvaluationMapView drilldown — état vide honnête", () => {
ui/src/lib/components/maps/EvaluationMapView.test.ts:562:      { type: "Feature", geometry: null, properties: { noLot: "A", citySlug: "x" } },
ui/src/lib/components/maps/EvaluationMapView.test.ts:563:      { type: "Feature", geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, properties: { noLot: "B", citySlug: "x" } },
ui/src/lib/components/maps/EvaluationMapView.test.ts:564:      { type: "Feature", geometry: { type: "Point", coordinates: [0, 0] }, properties: { noLot: "C", citySlug: "x" } },
ui/src/lib/components/maps/EvaluationMapView.test.ts:568:    expect(polygons[0]!.properties.noLot).toBe("B");
ui/src/lib/components/maps/CadastreMapView.svelte:18:   * Anti-PII (Loi 25) : on n'affiche que `noLot` (NO_LOT cadastral public) ;
ui/src/lib/components/maps/CadastreMapView.svelte:22:   * `cadastre-geojson-source.ts deriveLotPotentialScore`).
ui/src/lib/components/maps/CadastreMapView.svelte:32:  } from "$lib/maps/cadastre-geojson-source.js";
ui/src/lib/components/maps/CadastreMapView.svelte:100:                      "&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors",
ui/src/lib/components/maps/CadastreMapView.svelte:194:        // ── Interaction : clic lot → détail (noLot uniquement, anti-PII) ──
ui/src/lib/components/maps/CadastreMapView.svelte:307:    <!-- Détail lot sélectionné (anti-PII : noLot + champs publics) -->
ui/src/lib/components/maps/CadastreMapView.svelte:316:            <span class="font-mono font-bold text-radar-ink">{selectedLot.noLot}</span>
ui/src/lib/components/maps/MapLegend.svelte:5:   * Composant local extrait de EvaluationMapView pour préparer
ui/src/lib/components/maps/SignalPdfOverlay.svelte:238:<div class="pdf-overlay" aria-label="Preuve documentaire" role="dialog" aria-modal="true">
ui/src/lib/components/maps/SignalPdfOverlay.svelte:267:      <div class="pdf-control-group pdf-page-group" role="group" aria-label="Navigation des pages">
ui/src/lib/components/maps/SignauxMapView.svelte:74:  import type { GeoJsonGeometry } from "$lib/maps/cadastre-geojson-source.js";
ui/src/lib/components/maps/SignauxMapView.svelte:403:      const noLot = readString(props?.noLot);
ui/src/lib/components/maps/SignauxMapView.svelte:405:      if (!noLot || !citySlug) return;
ui/src/lib/components/maps/SignauxMapView.svelte:407:      toggleMapSelection(makeKey("lot", `${citySlug}/${noLot}`));
ui/src/lib/components/maps/SignauxMapView.svelte:437:              attribution: "© OpenStreetMap contributors",
ui/src/lib/components/maps/SignauxMapView.svelte:738:  function lotSelectionKey(noLot: string, citySlug = selectedCity?.municipality.slug): SelectionKey | null {
ui/src/lib/components/maps/SignauxMapView.svelte:740:    return makeKey("lot", `${citySlug}/${noLot}`);
ui/src/lib/components/maps/SignauxMapView.svelte:845:    const expr: unknown[] = ["match", ["get", "noLot"]];
ui/src/lib/components/maps/SignauxMapView.svelte:848:      const noLot = lot.properties.noLot;
ui/src/lib/components/maps/SignauxMapView.svelte:851:        opacity = signalLotRefs.has(noLot) ? 0.85 : 0.15;
ui/src/lib/components/maps/SignauxMapView.svelte:853:        const key = lotSelectionKey(noLot, lot.properties.citySlug ?? citySlug);
ui/src/lib/components/maps/SignauxMapView.svelte:856:      expr.push(noLot, opacity);
ui/src/lib/components/maps/SignauxMapView.svelte:1044:        firstLot.properties.noLot,
ui/src/lib/components/maps/EvaluationMapView.svelte:3:   * EvaluationMapView — Vue Évaluation (maille zone/lots) — WP B slice-2.
ui/src/lib/components/maps/EvaluationMapView.svelte:15:   * Anti-PII (Loi 25) : seul `noLot` (NO_LOT du cadastre allégé) est affiché.
ui/src/lib/components/maps/EvaluationMapView.svelte:37:  import LotFichePanel from "$lib/components/maps/LotFichePanel.svelte";
ui/src/lib/components/maps/EvaluationMapView.svelte:72:  // source: "mrnf"  = cadastre allégé MRNF (donnees-quebec)
ui/src/lib/components/maps/EvaluationMapView.svelte:102:  // ── Données signaux (section grille — signaux réels depuis l'API) ─────────
ui/src/lib/components/maps/EvaluationMapView.svelte:181:  function hasEvaluationData(signal: SignalT | null): boolean {
ui/src/lib/components/maps/EvaluationMapView.svelte:189:  $: evalAvailable = hasEvaluationData(selectedSignal);
ui/src/lib/components/maps/EvaluationMapView.svelte:344:      const key = lotKey(mark.noLot, mark.citySlug);
ui/src/lib/components/maps/EvaluationMapView.svelte:350:      noLot: feature.properties.noLot,
ui/src/lib/components/maps/EvaluationMapView.svelte:357:    const key = lotKey(feature.properties.noLot, feature.properties.citySlug ?? selectedEvalCity?.slug ?? "");
ui/src/lib/components/maps/EvaluationMapView.svelte:358:    const marks = prospectMarks.filter((mark) => lotKey(mark.noLot, mark.citySlug) === key);
ui/src/lib/components/maps/EvaluationMapView.svelte:378:  <!-- ── Left: sélecteur évaluation (lots + zonage) + signaux ────────────── -->
ui/src/lib/components/maps/EvaluationMapView.svelte:383:      <h1 class="text-sm font-bold text-slate-900">Évaluation : Lots & Zonage</h1>
ui/src/lib/components/maps/EvaluationMapView.svelte:587:  <!-- ── Main: panneau côte à côte zonage + lots + grille signal ───────────── -->
ui/src/lib/components/maps/EvaluationMapView.svelte:775:                role="img"
ui/src/lib/components/maps/EvaluationMapView.svelte:781:                {#each filteredPolygonFeatures as feature (feature.properties.noLot)}
ui/src/lib/components/maps/EvaluationMapView.svelte:783:                  {@const isHovered = hoveredLot === feature.properties.noLot}
ui/src/lib/components/maps/EvaluationMapView.svelte:784:                  {@const isLotSelected = selectedLot?.properties.noLot === feature.properties.noLot}
ui/src/lib/components/maps/EvaluationMapView.svelte:785:                  {@const lotMarks = prospectMarksByLot.get(lotKey(feature.properties.noLot, feature.properties.citySlug ?? selectedEvalCity?.slug ?? "")) ?? []}
ui/src/lib/components/maps/EvaluationMapView.svelte:797:                      on:mouseenter={() => { hoveredLot = feature.properties.noLot; }}
ui/src/lib/components/maps/EvaluationMapView.svelte:799:                      role="button"
ui/src/lib/components/maps/EvaluationMapView.svelte:800:                      aria-label="Lot {feature.properties.noLot}"
ui/src/lib/components/maps/EvaluationMapView.svelte:821:                          {feature.properties.noLot}{lotPipelineMark ? ` · ${prospectStatusShortLabel(lotPipelineMark.statut)}` : lotMarketMark ? ` · ${prospectStatusShortLabel(lotMarketMark.statut)}` : ""}
ui/src/lib/components/maps/EvaluationMapView.svelte:837:                  <LotFichePanel
ui/src/lib/components/maps/EvaluationMapView.svelte:851:    <!-- ─── Section grille d'évaluation signal ─────────────────────────────── -->
ui/src/lib/components/maps/EvaluationMapView.svelte:892:        <!-- Grille d'évaluation (5 axes) -->

## Fichiers candidats
api/src/routes/geo-features.test.ts
api/src/routes/geo-features.ts
api/src/routes/geo-lots.test.ts
api/src/routes/geo-lots.ts
api/src/routes/geo-zones.test.ts
api/src/routes/geo-zones.ts
api/src/routes/prospect-marks.test.ts
api/src/routes/prospect-marks.ts
api/src/scripts/populate-geo.ts
api/src/scripts/pull-geo-ogc.ts
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
api/src/services/prospect/contact-service.ts
api/src/services/prospect/marks-service.ts
api/src/services/scoring/lot-potential.test.ts
api/src/services/scoring/lot-potential.ts
packages/radar-domain/src/geo/geo-category-mapping.ts
packages/radar-domain/src/schemas/ontology/geo.ts
packages/radar-domain/src/schemas/prospect-mark.test.ts
packages/radar-domain/src/schemas/prospect-mark.ts
packages/radar-sources/src/geo/geo-fetch-utils.ts
packages/radar-sources/src/geo/geo-source-inventory.data.ts
packages/radar-sources/src/geo/geo-source-inventory.test.ts
packages/radar-sources/src/geo/geo-source-inventory.ts
packages/radar-sources/src/geo/geo-vertical-priority.ts
packages/radar-sources/src/geo/municipalities.qc.json
packages/radar-sources/src/sources/role-evaluation-mamh.fixture.ts
packages/radar-sources/src/sources/role-evaluation-mamh.test.ts
packages/radar-sources/src/sources/role-evaluation-mamh.ts
packages/radar-sources/src/sources/role-evaluation-parser.test.ts
packages/radar-sources/src/sources/role-evaluation-parser.ts
packages/radar-sources/src/sources/_spikes/adresses-quebec-igo-geocoder/README.md
packages/radar-sources/src/sources/_spikes/adresses-quebec-igo-geocoder/samples/terrapi-adresses-beauharnois.json
packages/radar-sources/src/sources/_spikes/adresses-quebec-igo-geocoder/samples/terrapi-adresses-salaberry.json
packages/radar-sources/src/sources/_spikes/adresses-quebec-igo-geocoder/samples/terrapi-municipalites-beauharnois.json
packages/radar-sources/src/sources/_spikes/cadastre-infolot/README.md
packages/radar-sources/src/sources/_spikes/contraintes-geo-valleyfield.md
packages/radar-sources/src/sources/_spikes/roles-evaluation-fonciere-mamh/README.md
packages/radar-sources/src/sources/_spikes/roles-evaluation-fonciere-mamh/samples/indexRole2026.excerpt.csv
packages/radar-sources/src/sources/_spikes/roles-evaluation-fonciere-mamh/samples/RL70022_2026.first-record.xml
packages/radar-sources/src/sources/_spikes/roles-evaluation-fonciere-mamh/samples/RL70052_2026.first-record.xml
ui/src/lib/components/geo/geo-categories.ts
ui/src/lib/components/geo/geo-client.ts
ui/src/lib/components/geo/GeoView.svelte
ui/src/lib/components/maps/EvaluationMapView.svelte
ui/src/lib/components/maps/EvaluationMapView.test.ts
ui/src/lib/components/maps/LotFichePanel.svelte
ui/src/lib/components/maps/lot-fiche-utils.test.ts
ui/src/lib/components/maps/lot-fiche-utils.ts
ui/src/lib/maps/cadastre-geojson-source.test.ts
ui/src/lib/maps/cadastre-geojson-source.ts
ui/src/lib/maps/geo-level-navigation.ts
ui/src/lib/maps/geo-zones-client.ts
ui/src/lib/maps/lots-client.test.ts
ui/src/lib/maps/lots-client.ts
ui/src/lib/maps/signaux-map-geo.test.ts
ui/src/lib/maps/signaux-map-geo.ts
ui/src/lib/prospect/prospect-marks-client.test.ts
ui/src/lib/prospect/prospect-marks-client.ts
ui/src/lib/router/geo-route.test.ts
ui/src/lib/router/geo-route.ts
ui/src/lib/source-review/source-evaluation-data.test.ts
ui/src/lib/source-review/source-evaluation-data.ts
