# CS-L1 — scoring visuel lots

## Occurrences scoring / bucket / TOD / potentiel
ui/src/app.css:13:  color-scheme: light;
ui/src/App.svelte:10:  import GrillesView from "$lib/components/scoring/GrillesView.svelte";
ui/src/App.svelte:179:        <!-- Vue Signaux : carte aplats GeoJSON coloriés par nb d'opportunités / 6 mois -->
ui/src/lib/onboarding/onboarding-data.ts:76:    "Normalise les adresses textuelles en coordonnees geospatiales pour le scoring.",
ui/src/lib/onboarding/onboarding-data.ts:88:    "Grilles et plans de zonage officiels pour valider le potentiel de densification.",
ui/src/lib/onboarding/onboarding-data.ts:114:    "Hierarchie routiere pour le contexte d'accessibilite et de scoring de proximite.",
ui/src/lib/sources/maturity.ts:6: * Map a 0–100 maturity score to a Tailwind color name used for city dots.
ui/src/lib/sources/maturity.ts:30:  color: MaturityColor;
ui/src/lib/sources/maturity.ts:36: * maturity score. Returns one entry per unique citySlug, sorted by slug.
ui/src/lib/sources/maturity.ts:51:        color: cityMaturityColor(maturity),
ui/src/lib/sources/contribution.ts:11:import type { OpportunityDossierT, PhaseT, VerificationT } from "@radar/domain";
ui/src/lib/sources/contribution.ts:36:  dossiers: OpportunityDossierT[],
ui/src/lib/jobs/jobs-data.test.ts:33:    const validTypes = new Set(["ingestion", "scan", "scoring", "backfill"]);
ui/src/lib/jobs/jobs-data.ts:1:export type JobType = "ingestion" | "scan" | "scoring" | "backfill";
ui/src/lib/jobs/jobs-data.ts:35:    type: "scoring",
ui/src/lib/jobs/jobs-data.ts:100:  // Real mode hides simulation jobs (same boundary as @radar/scoring filterRealMode,
ui/src/lib/scoring/grilles-data.ts:1:import { GRIDS, WEIGHTS } from "@radar/scoring";
ui/src/lib/scoring/grilles-data.ts:6:  potentiel: "Potentiel réglementaire",
ui/src/lib/scoring/grilles-data.test.ts:31:    expect(axes).toEqual(["potentiel", "risque", "timing", "faisabilite", "marche"]);
ui/src/lib/components/coordination/CoordinationView.svelte:208:          placeholder="ex. potentiel de densification confirmé"
ui/src/lib/components/reconciliation/MrcGraphView.svelte:219:        class="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
ui/src/lib/components/reconciliation/MrcGraphView.svelte:310:            style={`background:${c.fill};border-color:${c.stroke};color:${c.text}`}
ui/src/lib/components/reconciliation/CityGraphView.svelte:194:      class="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
ui/src/lib/components/reconciliation/CityGraphView.svelte:232:            style={`background:${c.fill};border-color:${c.stroke};color:${c.text}`}
ui/src/lib/components/reconciliation/CityGraphView.test.ts:9: *   3. Type-color mapping
ui/src/lib/components/reconciliation/ReconciliationView.svelte:236:          class={`inline-flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors focus:outline-none ${
ui/src/lib/components/reconciliation/ReconciliationView.svelte:249:          class={`inline-flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors focus:outline-none ${
ui/src/lib/components/reconciliation/ReconciliationView.svelte:263:          class={`inline-flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors focus:outline-none ${
ui/src/lib/components/reconciliation/ReconciliationView.svelte:425:                {#if cand.score !== undefined}
ui/src/lib/components/reconciliation/ReconciliationView.svelte:426:                  <Badge tone="info">score {cand.score.toFixed(2)}</Badge>
ui/src/lib/components/scoring/ScoreHover.svelte:3:  import type { GrilleRow } from "$lib/scoring/grilles-data.js";
ui/src/lib/components/scoring/GrillesView.test.ts:2:import { toGrilleRows } from "$lib/scoring/grilles-data.js";
ui/src/lib/components/scoring/GrillesView.test.ts:4:import { WEIGHTS, aggregate } from "@radar/scoring";
ui/src/lib/components/scoring/GrillesView.test.ts:33:  it("dossier 1 (H-609-4) has aggregate score ~3.18", () => {
ui/src/lib/components/scoring/GrillesView.test.ts:36:    expect(result.score).not.toBeNull();
ui/src/lib/components/scoring/GrillesView.test.ts:37:    expect(Math.abs((result.score as number) - 3.18)).toBeLessThan(0.05);
ui/src/lib/components/scoring/GrillesView.test.ts:40:  it("dossier 2 (U-521) has aggregate score ~3.35", () => {
ui/src/lib/components/scoring/GrillesView.test.ts:43:    expect(result.score).not.toBeNull();
ui/src/lib/components/scoring/GrillesView.test.ts:44:    expect(Math.abs((result.score as number) - 3.35)).toBeLessThan(0.05);
ui/src/lib/components/scoring/GrillesView.test.ts:47:  it("dossier 3 (H-143) has aggregate score ~2.59", () => {
ui/src/lib/components/scoring/GrillesView.test.ts:50:    expect(result.score).not.toBeNull();
ui/src/lib/components/scoring/GrillesView.test.ts:51:    expect(Math.abs((result.score as number) - 2.59)).toBeLessThan(0.05);
ui/src/lib/components/scoring/GrillesView.svelte:8:  import { WEIGHTS, aggregate } from "@radar/scoring";
ui/src/lib/components/scoring/GrillesView.svelte:9:  import { toGrilleRows } from "$lib/scoring/grilles-data.js";
ui/src/lib/components/scoring/GrillesView.svelte:13:  // ── Type de score (bande latérale gauche) ──────────────────────────────────
ui/src/lib/components/scoring/GrillesView.svelte:16:  const scoreTypes: { id: ScoreTypeId; label: string; description: string }[] = [
ui/src/lib/components/scoring/GrillesView.svelte:27:        "Score composite /100 d'une opportunité foncière, agrégé sur cinq axes pondérés (0 à 5 par axe). Un axe non disponible renormalise le score et plafonne la recommandation à « qualifier avec expert ». Référence : PROCESS.md Étape 5.",
ui/src/lib/components/scoring/GrillesView.svelte:33:    scoreTypes.find((t) => t.id === activeScoreType)?.description ?? "";
ui/src/lib/components/scoring/GrillesView.svelte:48:  const axisOrder = ["potentiel", "risque", "timing", "faisabilite", "marche"] as const;
ui/src/lib/components/scoring/GrillesView.svelte:74:    scoreOver100: (() => {
ui/src/lib/components/scoring/GrillesView.svelte:76:      return r.score !== null ? Math.round(r.score * 20) : null;
ui/src/lib/components/scoring/GrillesView.svelte:95:  function score100Color(s: number | null): string {
ui/src/lib/components/scoring/GrillesView.svelte:104:  <!-- ── Bande latérale gauche : sélecteur du type de score + description ── -->
ui/src/lib/components/scoring/GrillesView.svelte:109:          Type de score
ui/src/lib/components/scoring/GrillesView.svelte:112:          {#each scoreTypes as type}
ui/src/lib/components/scoring/GrillesView.svelte:145:        Référence : modele de score
ui/src/lib/components/scoring/GrillesView.svelte:148:        Grilles de score
ui/src/lib/components/scoring/GrillesView.svelte:151:        Le modele utilise deux mesures distinctes : le tri de signal (/10, par type) et le score d'opportunite (/100, composite multi-axes). Elles ne sont jamais combinées.
ui/src/lib/components/scoring/GrillesView.svelte:168:          Les <strong>derogations</strong> sont un filtre pur (VISION) : elles ne recoivent pas de score /10 et n'entrent pas dans le tri.
ui/src/lib/components/scoring/GrillesView.svelte:209:                  <Badge tone="neutral">Pas de score</Badge>
ui/src/lib/components/scoring/GrillesView.svelte:242:          Poids des axes (V1) : vue d'ensemble du score /100
ui/src/lib/components/scoring/GrillesView.svelte:273:        le score est renormalise sur les axes disponibles et la recommandation est plafonnee a
ui/src/lib/components/scoring/GrillesView.svelte:345:          class="flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
ui/src/lib/components/scoring/GrillesView.svelte:363:                Le score est renormalise sur 4 axes, plafonne a <strong class="text-amber-700">qualifier avec expert</strong>.
ui/src/lib/components/scoring/GrillesView.svelte:368:              {#each dossierResults as { dossier, result, scoreOver100 }}
ui/src/lib/components/scoring/GrillesView.svelte:377:                      {#if scoreOver100 !== null}
ui/src/lib/components/scoring/GrillesView.svelte:378:                        <span class={`text-xl font-bold ${score100Color(scoreOver100)}`}>
ui/src/lib/components/scoring/GrillesView.svelte:379:                          {scoreOver100}<span class="text-xs font-normal text-slate-400">/100</span>
ui/src/lib/components/TopNav.svelte:351:     liens de nav (état actif = SOULIGNEMENT `border-bottom-color` sur
ui/src/lib/components/TopNav.svelte:355:     bordure basse (transparente au repos, colorée sur l'actif). Touchant le
ui/src/lib/components/TopNav.svelte:394:    color: var(--st-semantic-text-secondary);
ui/src/lib/components/api-dependent.test.ts:11: *   - Colorisation carte MapLibre (couche fill-color selon score → token DS)
ui/src/lib/components/api-dependent.test.ts:25:    "Colorisation lot fill-color : un lot avec signal 'rezonage' doit avoir la couleur DS du score " +
ui/src/lib/components/api-dependent.test.ts:51:    "Header : navLink actif a border-bottom-color != transparent " +
ui/src/lib/components/RadarChatPanel.svelte:409:              class="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-700 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-50"
ui/src/lib/components/comparison/BenchmarkComparison.svelte:23:      Même prompt, modes d'exécution tracés, runs isolés, scoring neutre, sans tricher vs l'humain.
ui/src/lib/components/comparison/BenchmarkComparison.svelte:84:            {#each track.scores as score}
ui/src/lib/components/comparison/BenchmarkComparison.svelte:88:                    score >= 5
ui/src/lib/components/comparison/BenchmarkComparison.svelte:90:                      : score >= 3
ui/src/lib/components/comparison/BenchmarkComparison.svelte:95:                  {score}
ui/src/lib/components/signals/SignalRow.svelte:67:   * Explication du score /10 par type de signal (VISION §6).
ui/src/lib/components/signals/SignalRow.svelte:71:    "residential-rezoning": "Rezonage résidentiel = Priorité 1 VISION (§6) : signal le plus fort :création d'une nouvelle zone de densification autorisée par règlement adopté. Valeur 10/10 : impact direct sur le potentiel constructible.",
ui/src/lib/components/signals/SignalRow.svelte:77:    "derogation-relevant": "Dérogation pertinente = filtre pur VISION (§6) : pas de score /10. Les dérogations sont traitées comme filtre de contexte, pas comme signal de priorité.",
ui/src/lib/components/signals/SignalRow.svelte:78:    "derogation-irrelevant": "Dérogation non pertinente = filtre pur VISION : dérogation sans impact sur le potentiel foncier visé.",
ui/src/lib/components/signals/SignalRow.svelte:163:    <div class="flex shrink-0 flex-col items-center gap-0.5" title={isDerogation ? "Dérogation : filtre pur, pas de score /10 (VISION §6)" : "Valeur de triage /10 (priorité par type, VISION §6)"}>
ui/src/lib/components/signals/SignalRow.svelte:233:      <!-- Explication du scoring -->
ui/src/lib/components/signals/SignalRow.svelte:236:          Explication du scoring
ui/src/lib/components/signals/SignalsT1View.svelte:39:  let sortMode: "score" | "vision" = "score";
ui/src/lib/components/signals/SignalsT1View.svelte:88:            variant={sortMode === "score" ? "primary" : "secondary"}
ui/src/lib/components/signals/SignalsT1View.svelte:91:            title="Trier par valeur /10 (score de type calibré)"
ui/src/lib/components/signals/SignalsT1View.svelte:92:            onclick={() => { sortMode = "score"; sortDir = "desc"; }}
ui/src/lib/components/signals/SignalsT1View.svelte:94:            Par score /10
ui/src/lib/components/signals/SignalsT1View.svelte:137:                    Par score /10&nbsp;: importance métier calibrée.<br />
ui/src/lib/components/signals/SignalsT1View.svelte:188:        <span class="font-semibold text-slate-800">score d'opportunité (/100)</span>.
ui/src/lib/components/console/ConsoleView.svelte:41:      hint: "Exécutions unitaires : historique des runs d'ingestion et de scoring.",
ui/src/lib/components/console/SourceContributionTab.svelte:16:    scoring: "Scoring",
ui/src/lib/components/console/SourceContributionTab.svelte:31:      case "scoring":
ui/src/lib/components/console/SourceContributionTab.svelte:57:      ancrage, contraintes, marche, contexte, scoring) et le mix de verification
ui/src/lib/components/maps/lot-fiche-utils.ts:8: * (noLot, géométrie, score). Aucun nom de propriétaire ni PII n'est traité.
ui/src/lib/components/maps/lot-fiche-utils.ts:42:// ── Score de potentiel ─────────────────────────────────────────────────────────
ui/src/lib/components/maps/lot-fiche-utils.ts:45: * Retourne la tone Badge selon le score de potentiel (0–10).
ui/src/lib/components/maps/lot-fiche-utils.ts:49:export function scoreTone(
ui/src/lib/components/maps/lot-fiche-utils.ts:50:  score: number | null | undefined,
ui/src/lib/components/maps/lot-fiche-utils.ts:52:  if (score === undefined || score === null) return "neutral";
ui/src/lib/components/maps/lot-fiche-utils.ts:53:  if (score >= 7) return "success";
ui/src/lib/components/maps/lot-fiche-utils.ts:54:  if (score >= 4) return "warning";
ui/src/lib/components/maps/lot-fiche-utils.ts:55:  if (score >= 1) return "info";
ui/src/lib/components/maps/lot-fiche-utils.ts:60: * Retourne le label textuel du score de potentiel.
ui/src/lib/components/maps/lot-fiche-utils.ts:62:export function scoreLabel(score: number | null | undefined): string {
ui/src/lib/components/maps/lot-fiche-utils.ts:63:  if (score === undefined || score === null) return "non calculé";
ui/src/lib/components/maps/lot-fiche-utils.ts:64:  if (score >= 7) return "Élevé";
ui/src/lib/components/maps/lot-fiche-utils.ts:65:  if (score >= 4) return "Moyen";
ui/src/lib/components/maps/lot-fiche-utils.ts:66:  if (score >= 1) return "Faible";
ui/src/lib/components/maps/LotFichePanel.svelte:6:   * publiques du lot (cadastre + score de potentiel).
ui/src/lib/components/maps/LotFichePanel.svelte:11:   * - Score de potentiel : potentialScore (0–10, distinct du 0-5 T2)
ui/src/lib/components/maps/LotFichePanel.svelte:40:    scoreTone,
ui/src/lib/components/maps/LotFichePanel.svelte:41:    scoreLabel,
ui/src/lib/components/maps/LotFichePanel.svelte:146:            <div class="flex items-center gap-2" data-testid="fiche-score-mobile">
ui/src/lib/components/maps/LotFichePanel.svelte:150:              <Badge tone={scoreTone(potentialScore)}>{scoreLabel(potentialScore)}</Badge>
ui/src/lib/components/maps/LotFichePanel.svelte:200:        class="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-teal-100 hover:text-teal-700 shrink-0"
ui/src/lib/components/maps/LotFichePanel.svelte:235:      <!-- Section Score de potentiel ──────────────────────────────────────── -->
ui/src/lib/components/maps/LotFichePanel.svelte:236:      <section aria-labelledby="section-score">
ui/src/lib/components/maps/LotFichePanel.svelte:238:          id="section-score"
ui/src/lib/components/maps/LotFichePanel.svelte:242:          Score de potentiel
ui/src/lib/components/maps/LotFichePanel.svelte:246:          <div class="flex items-center gap-3" data-testid="fiche-score">
ui/src/lib/components/maps/LotFichePanel.svelte:250:            <Badge tone={scoreTone(potentialScore)}>
ui/src/lib/components/maps/LotFichePanel.svelte:251:              {scoreLabel(potentialScore)}
ui/src/lib/components/maps/LotFichePanel.svelte:255:            Échelle 0–10 · distinct du score T2 (0-5) et du score legacy (0-100).
ui/src/lib/components/maps/LotFichePanel.svelte:256:            Basé sur la densité de zone, le type, la présence en périmètre TOD.
ui/src/lib/components/maps/LotFichePanel.svelte:261:            data-testid="fiche-score-na"
ui/src/lib/components/maps/LotFichePanel.svelte:266:              (feat/api-score-potentiel-lot).
ui/src/lib/components/maps/LotFichePanel.svelte:398:            class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-teal-700 transition-colors hover:border-teal-300 hover:bg-teal-50"
ui/src/lib/components/maps/lot-fiche-utils.test.ts:4: * Couvre : centroid, googleMapsUrl, scoreTone, scoreLabel.
ui/src/lib/components/maps/lot-fiche-utils.test.ts:13:  scoreTone,
ui/src/lib/components/maps/lot-fiche-utils.test.ts:14:  scoreLabel,
ui/src/lib/components/maps/lot-fiche-utils.test.ts:115:// ── scoreTone ──────────────────────────────────────────────────────────────────
ui/src/lib/components/maps/lot-fiche-utils.test.ts:117:describe("scoreTone", () => {
ui/src/lib/components/maps/lot-fiche-utils.test.ts:119:    expect(scoreTone(undefined)).toBe("neutral");
ui/src/lib/components/maps/lot-fiche-utils.test.ts:123:    expect(scoreTone(0)).toBe("neutral");
ui/src/lib/components/maps/lot-fiche-utils.test.ts:127:    expect(scoreTone(1)).toBe("info");
ui/src/lib/components/maps/lot-fiche-utils.test.ts:131:    expect(scoreTone(3.5)).toBe("info");
ui/src/lib/components/maps/lot-fiche-utils.test.ts:135:    expect(scoreTone(4)).toBe("warning");
ui/src/lib/components/maps/lot-fiche-utils.test.ts:139:    expect(scoreTone(6.9)).toBe("warning");
ui/src/lib/components/maps/lot-fiche-utils.test.ts:143:    expect(scoreTone(7)).toBe("success");
ui/src/lib/components/maps/lot-fiche-utils.test.ts:147:    expect(scoreTone(10)).toBe("success");
ui/src/lib/components/maps/lot-fiche-utils.test.ts:151:// ── scoreLabel ─────────────────────────────────────────────────────────────────
ui/src/lib/components/maps/lot-fiche-utils.test.ts:153:describe("scoreLabel", () => {
ui/src/lib/components/maps/lot-fiche-utils.test.ts:155:    expect(scoreLabel(undefined)).toBe("non calculé");
ui/src/lib/components/maps/lot-fiche-utils.test.ts:159:    expect(scoreLabel(0)).toBe("Nul");
ui/src/lib/components/maps/lot-fiche-utils.test.ts:163:    expect(scoreLabel(1)).toBe("Faible");
ui/src/lib/components/maps/lot-fiche-utils.test.ts:167:    expect(scoreLabel(3.9)).toBe("Faible");
ui/src/lib/components/maps/lot-fiche-utils.test.ts:171:    expect(scoreLabel(4)).toBe("Moyen");
ui/src/lib/components/maps/lot-fiche-utils.test.ts:175:    expect(scoreLabel(6.9)).toBe("Moyen");
ui/src/lib/components/maps/lot-fiche-utils.test.ts:179:    expect(scoreLabel(7)).toBe("Élevé");
ui/src/lib/components/maps/lot-fiche-utils.test.ts:183:    expect(scoreLabel(10)).toBe("Élevé");
ui/src/lib/components/maps/lot-fiche-utils.test.ts:208:  it("scoreTone(5) → warning (moyen)", () => {
ui/src/lib/components/maps/lot-fiche-utils.test.ts:209:    expect(scoreTone(5)).toBe("warning");
ui/src/lib/components/maps/lot-fiche-utils.test.ts:212:  it("scoreLabel(5) → 'Moyen'", () => {
ui/src/lib/components/maps/lot-fiche-utils.test.ts:213:    expect(scoreLabel(5)).toBe("Moyen");
ui/src/lib/components/maps/SignauxSelPanel.svelte:3:   * SignauxSelPanel — right selection bucket for the Signaux map.
ui/src/lib/components/maps/SignauxSelPanel.svelte:33:  } from "$lib/maps/selection-bucket.js";
ui/src/lib/components/maps/SignauxSelPanel.svelte:334:    const score = lot.properties.potentialScore;
ui/src/lib/components/maps/SignauxSelPanel.svelte:335:    return typeof score === "number" ? `${score.toFixed(1)}/10` : null;
ui/src/lib/components/maps/SignauxSelPanel.svelte:357:      Cliquez sur une ville dans la liste ou sur la carte pour constituer le bucket.
ui/src/lib/components/maps/SignauxSelPanel.svelte:361:      <span class="sel-kicker" style="color: #0f766e;">Ville active</span>
ui/src/lib/components/maps/SignauxSelPanel.svelte:407:    <div class="sel-buckets">
ui/src/lib/components/maps/SignauxSelPanel.svelte:408:      <details class="sel-bucket" open>
ui/src/lib/components/maps/SignauxSelPanel.svelte:409:        <summary class="sel-bucket-head">
ui/src/lib/components/maps/SignauxSelPanel.svelte:410:          <span class="sel-bucket-name">Villes</span>
ui/src/lib/components/maps/SignauxSelPanel.svelte:446:      <details class="sel-bucket">
ui/src/lib/components/maps/SignauxSelPanel.svelte:447:        <summary class="sel-bucket-head">
ui/src/lib/components/maps/SignauxSelPanel.svelte:448:          <span class="sel-bucket-name">Signaux</span>
ui/src/lib/components/maps/SignauxSelPanel.svelte:579:      <details class="sel-bucket">
ui/src/lib/components/maps/SignauxSelPanel.svelte:580:        <summary class="sel-bucket-head">
ui/src/lib/components/maps/SignauxSelPanel.svelte:581:          <span class="sel-bucket-name">Zones</span>
ui/src/lib/components/maps/SignauxSelPanel.svelte:652:      <details class="sel-bucket">
ui/src/lib/components/maps/SignauxSelPanel.svelte:653:        <summary class="sel-bucket-head">
ui/src/lib/components/maps/SignauxSelPanel.svelte:654:          <span class="sel-bucket-name">Lots</span>
ui/src/lib/components/maps/SignauxSelPanel.svelte:753:    color: var(--st-semantic-text-muted, #94a3b8);
ui/src/lib/components/maps/SignauxSelPanel.svelte:765:    color: var(--st-semantic-text-secondary, #64748b);
ui/src/lib/components/maps/SignauxSelPanel.svelte:776:    color: var(--st-semantic-text-muted, #94a3b8);
ui/src/lib/components/maps/SignauxSelPanel.svelte:783:    color: #92400e;
ui/src/lib/components/maps/SignauxSelPanel.svelte:800:    color: var(--st-semantic-text-primary, #1e293b);
ui/src/lib/components/maps/SignauxSelPanel.svelte:806:    color: var(--st-semantic-text-muted, #94a3b8);
ui/src/lib/components/maps/SignauxSelPanel.svelte:822:    color: var(--st-semantic-text-muted, #94a3b8);
ui/src/lib/components/maps/SignauxSelPanel.svelte:825:  .sel-buckets {
ui/src/lib/components/maps/SignauxSelPanel.svelte:830:  .sel-bucket {
ui/src/lib/components/maps/SignauxSelPanel.svelte:834:  .sel-bucket-head {
ui/src/lib/components/maps/SignauxSelPanel.svelte:844:    color: var(--st-semantic-text-secondary, #475569);
ui/src/lib/components/maps/SignauxSelPanel.svelte:848:  .sel-bucket-head::-webkit-details-marker {
ui/src/lib/components/maps/SignauxSelPanel.svelte:852:  .sel-bucket-head::before {
ui/src/lib/components/maps/SignauxSelPanel.svelte:855:    color: var(--st-semantic-text-muted, #94a3b8);
ui/src/lib/components/maps/SignauxSelPanel.svelte:860:  details[open] > .sel-bucket-head::before {
ui/src/lib/components/maps/SignauxSelPanel.svelte:864:  .sel-bucket-name {
ui/src/lib/components/maps/SignauxSelPanel.svelte:880:    color: var(--st-semantic-text-secondary, #64748b);
ui/src/lib/components/maps/SignauxSelPanel.svelte:907:    color: var(--st-semantic-text-primary, #1e293b);
ui/src/lib/components/maps/SignauxSelPanel.svelte:916:    color: #0f766e;
ui/src/lib/components/maps/SignauxSelPanel.svelte:941:    color: var(--st-semantic-text-muted, #94a3b8);
ui/src/lib/components/maps/SignauxSelPanel.svelte:949:    color: var(--st-semantic-text-muted, #94a3b8);
ui/src/lib/components/maps/SignauxSelPanel.svelte:962:    color: var(--st-semantic-text-secondary, #475569);
ui/src/lib/components/maps/SignauxSelPanel.svelte:968:    color: var(--st-semantic-text-muted, #64748b);
ui/src/lib/components/maps/SignauxSelPanel.svelte:980:    color: var(--st-semantic-text-muted, #94a3b8);
ui/src/lib/components/maps/SignauxSelPanel.svelte:989:    color: var(--st-semantic-text-secondary, #475569);
ui/src/lib/components/maps/SignauxSelPanel.svelte:996:    color: var(--st-semantic-text-muted, #94a3b8);
ui/src/lib/components/maps/SignauxSelPanel.svelte:1009:    color: var(--st-semantic-text-muted, #94a3b8);
ui/src/lib/components/maps/SignauxSelPanel.svelte:1019:    color: var(--st-semantic-text-muted, #94a3b8);
ui/src/lib/components/maps/SignauxSelPanel.svelte:1026:    color: var(--st-semantic-text-muted, #94a3b8);
ui/src/lib/components/maps/SignauxSelPanel.svelte:1051:    color: #0f766e;
ui/src/lib/components/maps/SignauxSelPanel.svelte:1057:    color: #9a3412;
ui/src/lib/components/maps/SignauxSelPanel.svelte:1072:    color: #0f766e;
ui/src/lib/components/maps/SignauxSelPanel.svelte:1084:    border-color: var(--st-semantic-border-subtle, #e2e8f0);
ui/src/lib/components/maps/SignauxSelPanel.svelte:1086:    color: var(--st-semantic-text-muted, #94a3b8);
ui/src/lib/components/maps/SignauxSelPanel.svelte:1110:    color: #0f766e;
ui/src/lib/components/maps/SignauxSelPanel.svelte:1122:    color: var(--st-semantic-text-muted, #94a3b8);
ui/src/lib/components/maps/SignauxSelPanel.svelte:1131:    color: var(--st-semantic-text-secondary, #475569);
ui/src/lib/components/maps/SignauxRail.svelte:413:                                style={`--type-color: ${typeColor(node.type)}`}
ui/src/lib/components/maps/SignauxRail.svelte:477:    color: var(--st-semantic-text-muted, #64748b);
ui/src/lib/components/maps/SignauxRail.svelte:507:    background: var(--type-color);
ui/src/lib/components/maps/SignauxRail.svelte:514:    color: var(--st-semantic-text-secondary);
ui/src/lib/components/maps/SignauxRail.svelte:518:    color: var(--st-semantic-text-muted);

## Fichiers map candidates
ui/src/lib/components/maps/CadastreMapView.svelte
ui/src/lib/components/maps/DocumentOverlay.svelte
ui/src/lib/components/maps/EvaluationMapView.svelte
ui/src/lib/components/maps/EvaluationMapView.test.ts
ui/src/lib/components/maps/LotFichePanel.svelte
ui/src/lib/components/maps/lot-fiche-utils.test.ts
ui/src/lib/components/maps/lot-fiche-utils.ts
ui/src/lib/components/maps/MapLegend.svelte
ui/src/lib/components/maps/OpportunitesMapView.svelte
ui/src/lib/components/maps/SignalPdfOverlay.svelte
ui/src/lib/components/maps/SignauxMapView.svelte
ui/src/lib/components/maps/SignauxRail.svelte
ui/src/lib/components/maps/SignauxRail.test.ts
ui/src/lib/components/maps/SignauxSelPanelHarness.svelte
ui/src/lib/components/maps/signaux-sel-panel-preuve.test.ts
ui/src/lib/components/maps/SignauxSelPanel.svelte
ui/src/lib/components/maps/SignauxSelPanel.test.ts
ui/src/lib/components/opportunity/DossierCard.svelte
ui/src/lib/components/opportunity/OpportunityFunnel.svelte
ui/src/lib/components/opportunity/opportunity-funnel.test.ts
ui/src/lib/components/opportunity/PhaseColumn.svelte
ui/src/lib/components/RadarChatPanel.svelte
ui/src/lib/components/source-review/ChallengeResultsPanel.svelte
ui/src/lib/components/sources-map/CityDetailPanel.svelte
ui/src/lib/components/sources-map/SourcesMapView.svelte
ui/src/lib/components/sources-map/SourcesMapView.test.ts
