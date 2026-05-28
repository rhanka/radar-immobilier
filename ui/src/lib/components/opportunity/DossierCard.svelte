<script lang="ts">
  import { TrendingUp, Clock } from "@lucide/svelte";
  import type { AxisScoreT, OpportunityDossierT } from "@radar/domain";
  import { WEIGHTS, aggregate } from "@radar/scoring";
  import { toGrilleRows } from "$lib/scoring/grilles-data.js";
  import ScoreHover from "$lib/components/scoring/ScoreHover.svelte";
  import PhaseColumn from "./PhaseColumn.svelte";
  import { groupEvidenceByPhase, deriveTimeline, applyMode, axesForMode, isHypothesisAxis } from "$lib/opportunites/funnel.js";
  import type { AppMode } from "$lib/state/mode.js";

  export let dossier: OpportunityDossierT;
  export let mode: AppMode = "real";

  const grilleRows = toGrilleRows();
  const axisOrder = ["potentiel", "risque", "timing", "faisabilite", "marche"] as const;

  $: effectiveAxes = axesForMode(dossier.axes, mode);
  $: result = aggregate(effectiveAxes, WEIGHTS);
  $: scoreOver100 = result.score !== null ? Math.round(result.score * 20) : null;
  $: phases = groupEvidenceByPhase({
    ...dossier,
    evidence: applyMode(dossier.evidence, mode),
  });
  $: timeline = deriveTimeline(dossier);

  let hoveredAxis: string | null = null;

  function scoreColor(score: number | null): string {
    if (score === null) return "text-slate-400";
    if (score >= 3.5) return "text-emerald-700";
    if (score >= 2.5) return "text-amber-700";
    return "text-red-700";
  }

  function score100Color(s: number | null): string {
    if (s === null) return "text-slate-400";
    if (s >= 70) return "text-emerald-700";
    if (s >= 50) return "text-amber-700";
    return "text-red-700";
  }

  function capBadgeClass(cap: string): string {
    if (cap === "monter-dossier-acquisition") return "bg-emerald-100 text-emerald-700";
    if (cap === "qualifier-avec-expert") return "bg-amber-100 text-amber-700";
    if (cap === "approcher-proprietaire") return "bg-sky-100 text-sky-700";
    if (cap === "surveiller") return "bg-slate-100 text-slate-600";
    return "bg-red-100 text-red-700";
  }

  function capLabel(cap: string): string {
    if (cap === "monter-dossier-acquisition") return "Monter dossier acquisition";
    if (cap === "qualifier-avec-expert") return "Qualifier avec expert";
    if (cap === "approcher-proprietaire") return "Approcher propriétaire";
    if (cap === "surveiller") return "Surveiller";
    if (cap === "rejeter") return "Rejeter";
    return cap;
  }

  function phaseLabel(phase: string): string {
    const map: Record<string, string> = {
      signal: "Signal",
      ancrage: "Ancrage",
      contraintes: "Contraintes",
      marche: "Marché",
      contexte: "Contexte",
      scoring: "Scoring",
    };
    return map[phase] ?? phase;
  }

  /** True if the axis was available with low confidence in the original dossier
   *  (= hypothesis axis that gets excluded in real mode). */
  function isHypothesis(axis: string): boolean {
    const orig = dossier.axes[axis as keyof typeof dossier.axes] as AxisScoreT | undefined;
    return orig !== undefined && isHypothesisAxis(orig);
  }
</script>

<article class="rounded-xl border border-slate-200 bg-white shadow-sm">
  <!-- ── Dossier header ──────────────────────────────────────────────── -->
  <header class="border-b border-slate-100 px-5 py-4">
    <h2 class="text-lg font-semibold text-slate-950">{dossier.title}</h2>
    <p class="mt-0.5 text-sm text-slate-500">{dossier.address}</p>
    <div class="mt-2 flex flex-wrap gap-2">
      <span class="rounded bg-teal-100 px-2 py-0.5 text-xs font-semibold text-teal-700">
        Zone {dossier.zone}
      </span>
      <span class="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
        Règl. {dossier.bylaw}
      </span>
      <span class="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
        {dossier.lots.length} lot{dossier.lots.length > 1 ? "s" : ""}
      </span>
    </div>
  </header>

  <div class="p-5 space-y-6">
    <!-- ── 6-phase funnel ──────────────────────────────────────────────── -->
    <section>
      <h3 class="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Faisceau de preuves — 6 phases
      </h3>
      <div class="space-y-3">
        {#each phases as group (group.phase)}
          <PhaseColumn {group} />
        {/each}
        {#if phases.length === 0}
          <p class="text-sm text-slate-400 italic">
            Aucune preuve disponible pour le mode courant.
          </p>
        {/if}
      </div>
    </section>

    <!-- ── Honest score panel ─────────────────────────────────────────── -->
    <section class="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div class="mb-3 flex items-center gap-2">
        <TrendingUp class="h-4 w-4 text-teal-600" aria-hidden="true" />
        <h3 class="text-sm font-semibold uppercase tracking-wide text-slate-700">
          Score agrégé PROCESS
        </h3>
      </div>

      <!-- Mode banner -->
      {#if mode === "real"}
        <div class="mb-3 rounded border border-slate-300 bg-white px-3 py-2 text-xs text-slate-600">
          <span class="font-semibold text-slate-800">Mode réel :</span>
          seules les preuves confirmées comptent (hypothèses exclues, dossier plafonné).
        </div>
      {:else}
        <div class="mb-3 rounded border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-800">
          <span class="font-semibold">Mode simulation :</span>
          hypothèses incluses — score cible.
        </div>
      {/if}

      <!-- Score /100 headline + partial + cap -->
      <div class="mb-4 flex flex-wrap items-center gap-3">
        {#if result.tooThin}
          <span class="rounded bg-slate-200 px-3 py-1 text-lg font-bold text-slate-500">
            Trop mince — surveillance
          </span>
        {:else}
          <span class={`text-3xl font-bold ${score100Color(scoreOver100)}`}>
            Score radar {scoreOver100}<span class="text-base font-normal text-slate-400">/100</span>
          </span>
        {/if}
        {#if result.partial}
          <span class="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
            Partiel — marché non disponible
          </span>
        {/if}
        <span class={`rounded px-2 py-1 text-xs font-semibold ${capBadgeClass(result.recommendationCap)}`}>
          {capLabel(result.recommendationCap)}
        </span>
      </div>

      <!-- Per-axis breakdown with ScoreHover -->
      <div class="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {#each axisOrder as axis}
          {@const origAxisScore = dossier.axes[axis]}
          {@const effectiveAxisScore = effectiveAxes[axis]}
          {@const gridRow = grilleRows.find((r) => r.axis === axis)}
          {#if origAxisScore && effectiveAxisScore && gridRow}
            {@const hypothesis = isHypothesis(axis)}
            {@const excludedInReal = mode === "real" && hypothesis}
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <div
              class="relative"
              on:mouseenter={() => { hoveredAxis = axis; }}
              on:mouseleave={() => { hoveredAxis = null; }}
              on:focusin={() => { hoveredAxis = axis; }}
              on:focusout={() => { hoveredAxis = null; }}
            >
              <div
                class={`cursor-default rounded border px-3 py-2 transition ${
                  effectiveAxisScore.availability === "non-disponible"
                    ? excludedInReal
                      ? "border-slate-200 bg-slate-100 opacity-60"
                      : "border-slate-200 bg-white"
                    : "border-teal-100 bg-teal-50"
                }`}
              >
                <p class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {gridRow.label}
                </p>
                {#if effectiveAxisScore.availability === "non-disponible"}
                  {#if excludedInReal}
                    <p class="mt-0.5 text-[10px] font-semibold text-slate-400">
                      À confirmer — exclu en mode réel
                    </p>
                    <p class="mt-0.5 text-[10px] text-slate-400 line-through">
                      {origAxisScore.level}/5 (hypothèse)
                    </p>
                  {:else}
                    <p class="mt-0.5 text-xs font-semibold text-slate-400">Non disponible</p>
                  {/if}
                {:else}
                  <p class="mt-0.5 text-base font-bold text-teal-700">
                    {effectiveAxisScore.level}/5
                  </p>
                  {#if hypothesis && mode === "simulation"}
                    <p class="mt-0.5 text-[10px] font-medium text-violet-600">
                      hypothèse (simulation)
                    </p>
                  {/if}
                {/if}
                <p class="mt-0.5 text-[10px] text-slate-400">
                  Poids {gridRow.weightPct.toFixed(0)} %
                </p>
              </div>

              <!-- ScoreHover tooltip -->
              {#if hoveredAxis === axis}
                <div class="absolute bottom-full left-0 z-10 mb-1">
                  <ScoreHover
                    axisScore={effectiveAxisScore}
                    grid={gridRow}
                    axisLabel={gridRow.label}
                  />
                </div>
              {/if}
            </div>
          {/if}
        {/each}
      </div>

      <!-- Recommendation free-text -->
      <div class="rounded-lg border border-teal-100 bg-teal-50 px-4 py-3">
        <p class="text-xs font-semibold uppercase tracking-wide text-teal-700">Recommandation</p>
        <p class="mt-1 text-sm leading-6 text-slate-700">{dossier.recommendation}</p>
      </div>
    </section>

    <!-- ── Timeline ───────────────────────────────────────────────────── -->
    <section>
      <div class="mb-2 flex items-center gap-2">
        <Clock class="h-4 w-4 text-slate-400" aria-hidden="true" />
        <h3 class="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Chronologie des preuves
        </h3>
      </div>
      <ol class="relative border-l border-slate-200 pl-4 space-y-3">
        {#each timeline as item, i}
          <li class="relative">
            <span class="absolute -left-[1.125rem] mt-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-teal-400"></span>
            <p class="text-[10px] font-semibold text-slate-400">{item.date}</p>
            <p class="text-xs text-slate-700">
              <span class="font-medium text-teal-700">{phaseLabel(item.phase)}</span>
              · {item.label}
            </p>
          </li>
        {/each}
      </ol>
    </section>
  </div>
</article>
