<script lang="ts">
  import { Info, ChevronDown, ChevronUp, ChevronRight, Pencil } from "@lucide/svelte";
  import { Card, Badge, Alert, Popover } from "@sentropic/design-system-svelte";
  import Acronym from "$lib/components/Acronym.svelte";
  import ViewLayout from "$lib/components/ViewLayout.svelte";
  import { SIGNAL_TYPE_VALUES } from "@radar/domain";
  import { valleyfieldDossiers } from "@radar/domain";
  import { WEIGHTS, aggregate } from "@radar/scoring";
  import { toGrilleRows } from "$lib/scoring/grilles-data.js";
  import type { AxisT } from "@radar/domain";
  import ScoreHover from "./ScoreHover.svelte";

  // ── Type de score (bande latérale gauche) ──────────────────────────────────
  type ScoreTypeId = "signal" | "opportunite";

  const scoreTypes: { id: ScoreTypeId; label: string; description: string }[] = [
    {
      id: "signal",
      label: "Tri de signal (/10)",
      description:
        "Valeur /10 attribuée à chaque signal selon son TYPE (priorité réglementaire), affichée avec une confiance distincte. Valeur et confiance ne sont jamais multipliées. Sert à trier le flux de signaux entrants. Référence : VISION.md §6.",
    },
    {
      id: "opportunite",
      label: "Score d'opportunité (/100)",
      description:
        "Score composite /100 d'une opportunité foncière, agrégé sur cinq axes pondérés (0 à 5 par axe). Un axe non disponible renormalise le score et plafonne la recommandation à « qualifier avec expert ». Référence : PROCESS.md Étape 5.",
    },
  ];

  let activeScoreType: ScoreTypeId = "signal";
  $: activeDescription =
    scoreTypes.find((t) => t.id === activeScoreType)?.description ?? "";

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

  // ── Édition locale des rationnels de niveaux (état composant, non persisté) ──
  type Level = 0 | 1 | 2 | 3 | 4 | 5;
  const LEVELS: Level[] = [0, 1, 2, 3, 4, 5];
  type LevelMap = Record<Level, string>;
  // Copie mutable des libellés de niveau par axe (clé = axe).
  let editableLevels: Record<AxisT, LevelMap> = grilleRows.reduce(
    (acc, row) => {
      acc[row.axis] = { ...row.levels };
      return acc;
    },
    {} as Record<AxisT, LevelMap>,
  );

  // ── Axes en accordéon : id de l'axe déplié (null = tous repliés) ────────────
  let expandedAxis: AxisT | null = null;

  function toggleAxis(axis: AxisT): void {
    expandedAxis = expandedAxis === axis ? null : axis;
  }

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

<ViewLayout>
  <!-- ── Bande latérale gauche : sélecteur du type de score + description ── -->
  <svelte:fragment slot="controls">
    <div class="space-y-5 p-4">
      <div>
        <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Type de score
        </p>
        <div class="space-y-1.5">
          {#each scoreTypes as type}
            <button
              type="button"
              class={`w-full rounded-md border px-3 py-2 text-left text-sm transition ${
                activeScoreType === type.id
                  ? "border-teal-600 bg-teal-600 text-white shadow-sm"
                  : "border-slate-200 bg-white text-slate-700 hover:border-teal-400 hover:bg-slate-50"
              }`}
              aria-pressed={activeScoreType === type.id}
              on:click={() => { activeScoreType = type.id; }}
            >
              {type.label}
            </button>
          {/each}
        </div>
      </div>

      <div class="rounded-md border border-slate-200 bg-slate-50 p-3">
        <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Description
        </p>
        <p class="mt-1.5 text-sm leading-6 text-slate-600">
          {activeDescription}
        </p>
      </div>
    </div>
  </svelte:fragment>

  <!-- ── Contenu principal ──────────────────────────────────────────────── -->
  <section class="min-h-full bg-slate-50 p-6">
    <!-- Header -->
    <header class="mb-6">
      <p class="text-xs font-medium uppercase tracking-normal text-teal-700">
        Référence : modele de score
      </p>
      <h1 class="mt-1 text-2xl font-semibold tracking-normal text-slate-950">
        Grilles de score
      </h1>
      <p class="mt-1 text-sm text-slate-500">
        Le modele utilise deux mesures distinctes : le tri de signal (/10, par type) et le score d'opportunite (/100, composite multi-axes). Elles ne sont jamais combinées.
      </p>
    </header>

    <!-- ═══ TYPE A : Tri de signal (/10) ═══════════════════════════════════ -->
    {#if activeScoreType === "signal"}
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
              <span class="col-span-7 text-sm text-slate-800">
                {#if row.type === "cptaq" || row.type === "ppcmoi"}
                  <Acronym term={row.label} />
                {:else}
                  {row.label}
                {/if}
              </span>
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
        <p class="mt-2 text-xs text-slate-400">
          Référence : VISION.md §6 (priorites par type)
        </p>
      </div>
    {/if}

    <!-- ═══ TYPE B : Score d'opportunite (/100) ════════════════════════════ -->
    {#if activeScoreType === "opportunite"}
      <div class="mb-4">
        <Alert
          tone="info"
          title="Score d'opportunite : 5 axes ponderes (total /100)"
        />
      </div>

      <!-- ── Poids des axes d'abord (pleine largeur, vue d'ensemble) ──────── -->
      <div class="mb-6 rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <h2 class="mb-3 text-sm font-semibold text-slate-950">
          Poids des axes (V1) : vue d'ensemble du score /100
        </h2>
        <div class="flex flex-wrap gap-2">
          {#each grilleRows as row}
            <div class="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
              <span class="text-sm font-medium text-slate-700">{row.label}</span>
              <Badge tone="neutral">{row.weightPct.toFixed(0)} %</Badge>
            </div>
          {/each}
        </div>
        <!-- Barre de répartition 30/20/20/15/15 -->
        <div class="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
          {#each grilleRows as row, i}
            <div
              class={`h-full ${i % 2 === 0 ? "bg-teal-500" : "bg-teal-300"}`}
              style={`width: ${row.weightPct}%`}
              title={`${row.label} : ${row.weightPct.toFixed(0)} %`}
            ></div>
          {/each}
        </div>
        <p class="mt-3 text-xs text-slate-500">
          Les poids sont fixes en V1 (PROCESS). La renormalisation sur axes disponibles conserve les rapports de poids entre axes presents.
        </p>
        <p class="mt-2 text-xs text-slate-400">
          Référence : PROCESS.md Etape 5 (5 axes ponderes)
        </p>
      </div>

      <p class="mb-3 text-sm text-slate-600">
        Chaque opportunite est notee de <strong>0 a 5</strong> sur cinq axes ponderes (total /100).
        Un axe sans donnee disponible est marque <strong class="text-slate-700">non-disponible</strong> :
        le score est renormalise sur les axes disponibles et la recommandation est plafonnee a
        <strong class="text-amber-700">qualifier avec expert</strong> automatiquement.
      </p>

      <!-- Bandeau édition locale -->
      <div class="mb-4">
        <Alert
          tone="warning"
          title="Rationnels éditables (édition locale, non persistée)"
          message="Les libellés des niveaux 0 à 5 peuvent être ajustés ici pour calibrer la grille. Les modifications restent dans cette session et ne sont pas enregistrées côté serveur."
        />
      </div>

      <!-- ── Fiches axes en accordéon (≈50% largeur) avec rationnels éditables ── -->
      <div class="grid gap-4 lg:grid-cols-2">
        {#each grilleRows as row}
          {@const isAxisOpen = expandedAxis === row.axis}
          <Card class="overflow-hidden">
            <!-- En-tête de l'axe : clic déplie / replie -->
            <button
              type="button"
              class="flex w-full items-center gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3 text-left transition hover:bg-slate-100"
              aria-expanded={isAxisOpen}
              on:click={() => toggleAxis(row.axis)}
            >
              <span class="shrink-0 text-slate-400">
                {#if isAxisOpen}
                  <ChevronDown class="h-4 w-4" aria-hidden="true" />
                {:else}
                  <ChevronRight class="h-4 w-4" aria-hidden="true" />
                {/if}
              </span>
              <span class="min-w-0 flex-1">
                <span class="block text-sm font-semibold text-slate-950">{row.label}</span>
                <span class="text-[11px] text-slate-400">Grille {row.version}, PROCESS Étape 5</span>
              </span>
              <Badge tone="neutral">{row.weightPct.toFixed(0)} %</Badge>
            </button>

            <!-- Niveaux 0-5 : rationnels éditables (inline textarea, état local) -->
            {#if isAxisOpen}
              <div class="divide-y divide-slate-50">
                <div class="flex items-center gap-1.5 px-4 py-2 text-[11px] font-medium text-amber-600">
                  <Pencil class="h-3 w-3" aria-hidden="true" />
                  Rationnels éditables (édition locale, non persistée)
                </div>
                {#each LEVELS as lvl}
                  <div class="flex items-start gap-3 px-4 py-2.5">
                    <span class="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-slate-100 text-xs font-bold text-slate-600">
                      {lvl}
                    </span>
                    <label class="sr-only" for={`grille-${row.axis}-${lvl}`}>
                      Rationnel niveau {lvl} de l'axe {row.label}
                    </label>
                    <textarea
                      id={`grille-${row.axis}-${lvl}`}
                      class="min-h-[3.25rem] w-full resize-y rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm leading-5 text-slate-700 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-300"
                      bind:value={editableLevels[row.axis][lvl]}
                      rows="2"
                    ></textarea>
                  </div>
                {/each}
              </div>
            {/if}
          </Card>
        {/each}
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

                  <!-- Per-axis breakdown with ScoreHover via Popover DS -->
                  <div class="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-5">
                    {#each axisOrder as axis}
                      {@const axisScore = dossier.axes[axis]}
                      {@const gridRow = grilleRows.find((r) => r.axis === axis)}
                      {#if axisScore && gridRow}
                        <Popover
                          label="Détail axe {gridRow.label}"
                          placement="top"
                        >
                          {#snippet trigger()}
                            <div
                              class={`rounded border px-3 py-2 cursor-default ${
                                axisScore.availability === "non-disponible"
                                  ? "border-slate-200 bg-slate-50"
                                  : "border-teal-100 bg-teal-50"
                              }`}
                              tabindex="0"
                              role="button"
                              aria-label="Détail axe {gridRow.label}"
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
                          {/snippet}
                          {#snippet children()}
                            <ScoreHover
                              {axisScore}
                              grid={gridRow}
                              axisLabel={gridRow.label}
                            />
                          {/snippet}
                        </Popover>
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
</ViewLayout>
