<script lang="ts">
  import { Info, ChevronDown, ChevronUp } from "@lucide/svelte";
  import { Card, Badge, Alert } from "@sentropic/design-system-svelte";
  import { SIGNAL_TYPE_VALUES } from "@radar/domain";
  import { valleyfieldDossiers } from "@radar/domain";
  import { WEIGHTS, aggregate } from "@radar/scoring";
  import { toGrilleRows } from "$lib/scoring/grilles-data.js";
  import ScoreHover from "./ScoreHover.svelte";

  // ── Section tabs ─────────────────────────────────────────────────────────────
  type TabId = "signal" | "opportunite";

  const tabs: { id: TabId; label: string }[] = [
    { id: "signal", label: "A. Tri de signal (/10)" },
    { id: "opportunite", label: "B. Score d'opportunite (/100)" },
  ];

  let activeTab: TabId = "signal";

  // Section A : signal type table
  const signalRows: { type: string; label: string; value: number | null }[] = [
    { type: "residential-rezoning", label: "Zonage residentiel", value: SIGNAL_TYPE_VALUES["residential-rezoning"] },
    { type: "cptaq",                label: "CPTAQ",              value: SIGNAL_TYPE_VALUES["cptaq"] },
    { type: "ppcmoi",               label: "PPCMOI",             value: SIGNAL_TYPE_VALUES["ppcmoi"] },
    { type: "plan-urbanisme",       label: "Plan d'urbanisme",   value: SIGNAL_TYPE_VALUES["plan-urbanisme"] },
    { type: "public-consultation",  label: "Consultation publique", value: SIGNAL_TYPE_VALUES["public-consultation"] },
    { type: "grid-cos-modification", label: "Modification de grille", value: SIGNAL_TYPE_VALUES["grid-cos-modification"] },
    { type: "derogation-relevant",  label: "Derogation (pertinente ou non)", value: null },
  ];

  // Section B : axis grid
  const grilleRows = toGrilleRows();
  const axisOrder = ["potentiel", "risque", "timing", "faisabilite", "marche"] as const;

  // ── Pilot calibration ────────────────────────────────────────────────────────
  $: dossierResults = valleyfieldDossiers.map((d) => ({
    dossier: d,
    result: aggregate(d.axes, WEIGHTS),
    scoreOver100: (() => {
      const r = aggregate(d.axes, WEIGHTS);
      return r.score !== null ? Math.round(r.score * 20) : null;
    })(),
  }));

  let showCalibration = false;

  // ── Per-dossier axis hover state ─────────────────────────────────────────────
  let hoveredKey: string | null = null;

  function hoverKey(dossierId: string, axis: string): string {
    return `${dossierId}:${axis}`;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function capLabel(cap: string): string {
    if (cap === "monter-dossier-acquisition") return "Monter dossier";
    if (cap === "qualifier-avec-expert") return "Qualifier avec expert";
    return "Surveiller";
  }

  function capTone(cap: string): "success" | "warning" | "neutral" {
    if (cap === "monter-dossier-acquisition") return "success";
    if (cap === "qualifier-avec-expert") return "warning";
    return "neutral";
  }

  function score100Color(s: number | null): string {
    if (s === null) return "text-slate-400";
    if (s >= 70) return "text-emerald-700";
    if (s >= 50) return "text-amber-700";
    return "text-red-700";
  }
</script>

<section class="min-h-full bg-slate-50 p-6">
  <!-- Header ------------------------------------------------------------------>
  <header class="mb-6">
    <p class="text-xs font-medium uppercase tracking-normal text-teal-700">
      Reference : modele de score
    </p>
    <h1 class="mt-1 text-2xl font-semibold tracking-normal text-slate-950">
      Grilles de score
    </h1>
    <p class="mt-1 text-sm text-slate-500">
      Le modele utilise deux mesures distinctes : le tri de signal (/10, par type) et le score d'opportunite (/100, composite multi-axes). Elles ne sont jamais combinées.
    </p>
  </header>

  <!-- Tab bar ----------------------------------------------------------------->
  <div class="mb-6 flex gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm w-fit">
    {#each tabs as tab}
      <button
        type="button"
        class={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
          activeTab === tab.id
            ? "bg-teal-600 text-white shadow-sm"
            : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
        }`}
        aria-pressed={activeTab === tab.id}
        on:click={() => { activeTab = tab.id; }}
      >
        {tab.label}
      </button>
    {/each}
  </div>

  <!-- ═══ SECTION A : Tri de signal (/10) ════════════════════════════════════ -->
  {#if activeTab === "signal"}
    <div class="mb-4">
      <Alert
        tone="info"
        title="Tri de signal : valeur /10 par type (VISION §6)"
      />
    </div>

    <div class="mb-4 rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <p class="text-sm text-slate-600">
        Chaque signal recoit une valeur /10 selon son <strong>TYPE</strong> (priorite reglementaire),
        affichee avec une confiance. La valeur et la confiance sont affichees separement et ne sont jamais multipliees.
        Les <strong>derogations</strong> sont un filtre pur (VISION) : elles ne recoivent pas de score /10 et n'entrent pas dans le tri.
      </p>
    </div>

    <Card>
      <!-- Table header -->
      <div class="grid grid-cols-12 gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
        <span class="col-span-7 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Type de signal
        </span>
        <span class="col-span-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Valeur /10
        </span>
        <span class="col-span-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Role
        </span>
      </div>

      <!-- Table rows -->
      <div class="divide-y divide-slate-100">
        {#each signalRows as row}
          <div class="grid grid-cols-12 items-center gap-2 px-4 py-3">
            <span class="col-span-7 text-sm text-slate-800">{row.label}</span>
            <span class="col-span-3">
              {#if row.value !== null}
                <span class="text-lg font-bold text-teal-700">{row.value}</span>
                <span class="ml-0.5 text-xs text-slate-400">/10</span>
              {:else}
                <Badge tone="neutral">Filtre pur</Badge>
              {/if}
            </span>
            <span class="col-span-2">
              {#if row.value !== null}
                <Badge tone="info">Tri</Badge>
              {:else}
                <Badge tone="neutral">Pas de score</Badge>
              {/if}
            </span>
          </div>
        {/each}
      </div>
    </Card>

    <div class="mt-4 rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <p class="text-xs text-slate-500">
        <strong class="text-slate-700">Lecture :</strong>
        Un signal de type "Zonage residentiel" a une valeur de priorite de 10/10 independamment de sa confiance.
        La confiance (haute / moyenne / faible) est affichee separement dans la vue Signaux.
        Elle ne modifie pas la valeur du signal ; elle indique la solidite de la preuve.
      </p>
    </div>
  {/if}

  <!-- ═══ SECTION B : Score d'opportunite (/100) ═════════════════════════════ -->
  {#if activeTab === "opportunite"}
    <div class="mb-4">
      <Alert
        tone="info"
        title="Score d'opportunite : 5 axes ponderes (total /100)"
      />
    </div>

    <div class="mb-6 rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <p class="text-sm text-slate-600">
        Chaque opportunite est notee de <strong>0 a 5</strong> sur cinq axes ponderes (total /100).
        Un axe sans donnee disponible est marque <strong class="text-slate-700">non-disponible</strong> :
        le score est renormalise sur les axes disponibles et la recommandation est plafonnee a
        <strong class="text-amber-700">qualifier avec expert</strong> automatiquement.
      </p>
    </div>

    <!-- Per-axis grid -->
    <div class="space-y-4">
      {#each grilleRows as row}
        <Card>
          <!-- Axis header -->
          <div class="flex items-center gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3">
            <div class="flex-1 min-w-0">
              <p class="text-sm font-semibold text-slate-950">{row.label}</p>
            </div>
            <Badge tone="neutral">{row.weightPct.toFixed(0)} %</Badge>
          </div>

          <!-- Level descriptions -->
          <div class="divide-y divide-slate-50">
            {#each [0, 1, 2, 3, 4, 5] as lvl}
              <div class="flex items-start gap-3 px-4 py-2.5">
                <span class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-slate-100 text-xs font-bold text-slate-600">
                  {lvl}
                </span>
                <p class="text-sm leading-5 text-slate-700">
                  {row.levels[lvl as 0 | 1 | 2 | 3 | 4 | 5]}
                </p>
              </div>
            {/each}
          </div>
        </Card>
      {/each}
    </div>

    <!-- Weights recap -->
    <div class="mt-6 rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <h2 class="mb-3 text-sm font-semibold text-slate-950">Poids des axes (V1)</h2>
      <div class="flex flex-wrap gap-2">
        {#each grilleRows as row}
          <div class="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <span class="text-sm font-medium text-slate-700">{row.label}</span>
            <Badge tone="neutral">{row.weightPct.toFixed(0)} %</Badge>
          </div>
        {/each}
      </div>
      <p class="mt-3 text-xs text-slate-500">
        Les poids sont fixes en V1 (PROCESS). La renormalisation sur axes disponibles conserve les rapports de poids entre axes presents.
      </p>
    </div>

    <!-- Pilot calibration (secondary, toggle) -->
    <div class="mt-6">
      <button
        type="button"
        class="flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
        on:click={() => { showCalibration = !showCalibration; }}
        aria-expanded={showCalibration}
      >
        {#if showCalibration}
          <ChevronUp class="h-4 w-4" aria-hidden="true" />
        {:else}
          <ChevronDown class="h-4 w-4" aria-hidden="true" />
        {/if}
        <Info class="h-4 w-4 text-teal-600" aria-hidden="true" />
        Calibration : 3 dossiers pilotes Valleyfield
      </button>

      {#if showCalibration}
        <div class="mt-4">
          <div class="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <p class="text-xs text-slate-700">
              Les 3 dossiers sont partiels (axe "Valeur marche" non disponible, Tier C).
              Le score est renormalise sur 4 axes, plafonne a <strong class="text-amber-700">qualifier avec expert</strong>.
            </p>
          </div>

          <div class="space-y-4">
            {#each dossierResults as { dossier, result, scoreOver100 }}
              <Card>
                <!-- Dossier summary -->
                <div class="flex items-center gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3">
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-semibold text-slate-950 truncate">{dossier.title}</p>
                    <p class="text-xs text-slate-500">Regl. {dossier.bylaw}, Zone {dossier.zone}</p>
                  </div>
                  <div class="flex items-center gap-2 shrink-0">
                    {#if scoreOver100 !== null}
                      <span class={`text-xl font-bold ${score100Color(scoreOver100)}`}>
                        {scoreOver100}<span class="text-xs font-normal text-slate-400">/100</span>
                      </span>
                    {:else}
                      <span class="text-sm text-slate-400">N/A</span>
                    {/if}
                    {#if result.partial}
                      <Badge tone="warning">Partiel</Badge>
                    {/if}
                    <Badge tone={capTone(result.recommendationCap)}>
                      {capLabel(result.recommendationCap)}
                    </Badge>
                  </div>
                </div>

                <!-- Per-axis breakdown -->
                <div class="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-5">
                  {#each axisOrder as axis}
                    {@const axisScore = dossier.axes[axis]}
                    {@const gridRow = grilleRows.find((r) => r.axis === axis)}
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
              </Card>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  {/if}
</section>
