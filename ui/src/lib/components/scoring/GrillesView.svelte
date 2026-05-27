<script lang="ts">
  import { SlidersHorizontal, Info, AlertCircle, ChevronDown, ChevronUp } from "@lucide/svelte";
  import { valleyfieldDossiers } from "@radar/domain";
  import { WEIGHTS, aggregate } from "@radar/scoring";
  import { toGrilleRows } from "$lib/scoring/grilles-data.js";
  import ScoreHover from "./ScoreHover.svelte";

  // ── Grille rows (mutable local copy for in-memory editing) ──────────────────
  let rows = toGrilleRows().map((r) => ({
    ...r,
    levels: { ...r.levels } as Record<0 | 1 | 2 | 3 | 4 | 5, string>,
    modified: false,
    localVersion: r.version,
  }));

  function onLevelEdit(row: (typeof rows)[number]) {
    if (!row.modified) {
      row.modified = true;
      row.localVersion = row.localVersion.includes("*") ? row.localVersion : row.localVersion + "*";
      rows = rows; // trigger Svelte reactivity
    }
  }

  // ── Dossier aggregation ─────────────────────────────────────────────────────
  $: dossierResults = valleyfieldDossiers.map((d) => ({
    dossier: d,
    result: aggregate(d.axes, WEIGHTS),
  }));

  // ── Per-dossier expand/collapse for axes ───────────────────────────────────
  let expandedDossier: string | null = null;

  function toggleDossier(id: string) {
    expandedDossier = expandedDossier === id ? null : id;
  }

  // ── Per-axis hover state ───────────────────────────────────────────────────
  let hoveredKey: string | null = null; // "dossierId:axis"

  function hoverKey(dossierId: string, axis: string): string {
    return `${dossierId}:${axis}`;
  }

  function scoreColor(score: number | null): string {
    if (score === null) return "text-slate-400";
    if (score >= 3.5) return "text-emerald-700";
    if (score >= 2.5) return "text-amber-700";
    return "text-red-700";
  }

  function capBadgeClass(cap: string): string {
    if (cap === "monter-dossier-acquisition") return "bg-emerald-100 text-emerald-700";
    if (cap === "qualifier-avec-expert") return "bg-amber-100 text-amber-700";
    return "bg-slate-100 text-slate-500";
  }

  function capLabel(cap: string): string {
    if (cap === "monter-dossier-acquisition") return "Monter dossier acquisition";
    if (cap === "qualifier-avec-expert") return "Qualifier avec expert";
    return "Surveiller";
  }

  const axisOrder = ["potentiel", "risque", "timing", "faisabilite", "marche"] as const;
</script>

<section class="min-h-full bg-slate-50 p-6">
  <!-- Header ---------------------------------------------------------------->
  <header class="mb-6">
    <p class="text-xs font-medium uppercase tracking-normal text-teal-700">
      Configuration — grilles de score
    </p>
    <h1 class="mt-1 text-2xl font-semibold tracking-normal text-slate-950">
      Grilles de score PROCESS
    </h1>
    <p class="mt-1 text-sm text-slate-500">
      5 axes pondérés — édition locale des descripteurs (persistance hors-périmètre ÉV3). Les scores partiels (axes non disponibles) déclenchent automatiquement un plafond <span class="font-medium text-amber-700">qualifier-avec-expert</span>.
    </p>
  </header>

  <!-- Grille editor --------------------------------------------------------->
  <div class="mb-8 space-y-4">
    {#each rows as row, rowIndex}
      <div class="rounded-lg border border-slate-200 bg-white shadow-sm">
        <!-- Axis header -->
        <div class="flex items-center gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3">
          <SlidersHorizontal class="h-4 w-4 shrink-0 text-teal-600" aria-hidden="true" />
          <div class="flex-1 min-w-0">
            <p class="text-sm font-semibold text-slate-950">{row.label}</p>
            <p class="text-xs text-slate-500">axe : {row.axis}</p>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <span class="rounded bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600">
              Poids : {row.weightPct.toFixed(0)} %
            </span>
            <span class={`rounded px-2 py-0.5 text-xs font-semibold ${row.modified ? "bg-amber-100 text-amber-700" : "bg-teal-100 text-teal-700"}`}>
              {row.localVersion}
            </span>
          </div>
        </div>

        <!-- 6 editable level rows -->
        <div class="divide-y divide-slate-100">
          {#each [0, 1, 2, 3, 4, 5] as lvl}
            <div class="flex items-start gap-3 px-4 py-2.5">
              <span class="mt-1 w-5 shrink-0 rounded bg-slate-100 text-center text-xs font-semibold text-slate-600">
                {lvl}
              </span>
              <textarea
                class="flex-1 resize-none rounded border border-slate-200 bg-white px-2 py-1 text-xs leading-5 text-slate-700 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-300"
                rows={2}
                bind:value={row.levels[lvl as 0 | 1 | 2 | 3 | 4 | 5]}
                on:input={() => onLevelEdit(row)}
              ></textarea>
            </div>
          {/each}
        </div>
      </div>
    {/each}
  </div>

  <!-- Dossiers calibrés ---------------------------------------------------->
  <div class="mb-4 flex items-center gap-2">
    <Info class="h-4 w-4 text-teal-600" aria-hidden="true" />
    <h2 class="text-base font-semibold text-slate-950">Dossiers calibrés — Valleyfield</h2>
  </div>
  <p class="mb-5 text-sm text-slate-500">
    3 dossiers réels scorés sur ces grilles. Les axes marqués <span class="font-medium text-slate-600">non disponible</span> (données payantes Tier C) déclenchent un score <em>partiel</em> et plafonnent la recommandation à <span class="font-medium text-amber-700">qualifier-avec-expert</span>.
  </p>

  <div class="space-y-4">
    {#each dossierResults as { dossier, result }}
      <div class="rounded-lg border border-slate-200 bg-white shadow-sm">
        <!-- Dossier summary bar -->
        <button
          type="button"
          class="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition"
          aria-expanded={expandedDossier === dossier.id}
          on:click={() => toggleDossier(dossier.id)}
        >
          <div class="flex-1 min-w-0">
            <p class="text-sm font-semibold text-slate-950 truncate">{dossier.title}</p>
            <p class="text-xs text-slate-500">Règl. {dossier.bylaw} — Zone {dossier.zone}</p>
          </div>

          <!-- Score or tooThin -->
          <div class="flex items-center gap-2 shrink-0">
            {#if result.tooThin}
              <span class="rounded bg-slate-200 px-2 py-0.5 text-sm font-semibold text-slate-500">
                Trop mince
              </span>
            {:else}
              <span class={`text-xl font-bold ${scoreColor(result.score)}`}>
                {result.score?.toFixed(2)}<span class="text-xs font-normal text-slate-400">/5</span>
              </span>
            {/if}

            <!-- partial badge -->
            {#if result.partial}
              <span class="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700">
                Partiel
              </span>
            {/if}

            <!-- recommendation cap -->
            <span class={`rounded px-2 py-0.5 text-[11px] font-semibold ${capBadgeClass(result.recommendationCap)}`}>
              {capLabel(result.recommendationCap)}
            </span>

            <span class="text-slate-400">
              {#if expandedDossier === dossier.id}
                <ChevronUp class="h-4 w-4" aria-hidden="true" />
              {:else}
                <ChevronDown class="h-4 w-4" aria-hidden="true" />
              {/if}
            </span>
          </div>
        </button>

        <!-- Per-axis breakdown (expanded) -->
        {#if expandedDossier === dossier.id}
          <div class="border-t border-slate-100 px-4 py-3">
            <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {#each axisOrder as axis}
                {@const axisScore = dossier.axes[axis]}
                {@const gridRow = rows.find((r) => r.axis === axis)}
                {#if axisScore && gridRow}
                  {@const key = hoverKey(dossier.id, axis)}
                  <!-- svelte-ignore a11y-no-static-element-interactions -->
                  <div
                    class="relative"
                    on:mouseenter={() => { hoveredKey = key; }}
                    on:mouseleave={() => { hoveredKey = null; }}
                    on:focusin={() => { hoveredKey = key; }}
                    on:focusout={() => { hoveredKey = null; }}
                  >
                    <div
                      class={`rounded border px-3 py-2 cursor-default ${
                        axisScore.availability === "non-disponible"
                          ? "border-slate-200 bg-slate-50"
                          : "border-teal-100 bg-teal-50"
                      }`}
                    >
                      <p class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        {gridRow.label}
                      </p>
                      {#if axisScore.availability === "non-disponible"}
                        <p class="mt-0.5 text-xs font-semibold text-slate-400">Non disponible</p>
                      {:else}
                        <p class="mt-0.5 text-base font-bold text-teal-700">
                          {axisScore.level}/5
                        </p>
                      {/if}
                      <p class="mt-0.5 text-[10px] text-slate-400">
                        Poids {gridRow.weightPct.toFixed(0)} %
                      </p>
                    </div>

                    <!-- ScoreHover tooltip -->
                    {#if hoveredKey === key}
                      <div class="absolute bottom-full left-0 z-10 mb-1">
                        <ScoreHover
                          {axisScore}
                          grid={gridRow}
                          axisLabel={gridRow.label}
                        />
                      </div>
                    {/if}
                  </div>
                {/if}
              {/each}
            </div>

            <!-- Recommendation text -->
            <div class="mt-3 rounded bg-slate-50 px-3 py-2">
              <p class="text-xs leading-5 text-slate-600">{dossier.recommendation}</p>
            </div>
          </div>
        {/if}
      </div>
    {/each}
  </div>

  <!-- Disclaimer footer ---------------------------------------------------->
  <div class="mt-6 flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
    <AlertCircle class="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
    <div>
      <h3 class="text-sm font-semibold text-slate-950">Persistance des modifications</h3>
      <p class="mt-1 text-sm leading-6 text-slate-700">
        Les modifications des descripteurs de niveaux sont en mémoire locale uniquement (ÉV3 hors-périmètre). Elles ne sont pas sauvegardées entre sessions. Les poids sont fixes (v1) — ÉV4 pour la calibration interactive.
      </p>
    </div>
  </div>
</section>
