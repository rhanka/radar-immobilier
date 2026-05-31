<script lang="ts">
  import { Info, PlayCircle, AlertCircle } from "@lucide/svelte";
  import {
    Select,
    Switch,
    Badge,
    Button,
    Alert,
    Card,
  } from "@sentropic/design-system-svelte";
  import type { RecommendationKind } from "$lib/source-review/source-evaluation-data.js";
  import {
    groupByRecommendation,
    defaultSelection,
    summarize,
    RECOMMENDATION_LABELS_FR,
    VISION_ALIGNMENT_LABELS_FR,
    RETRO_WINDOW_MONTHS_DEFAULT,
    QUEBEC_MUNICIPALITIES,
    DEFAULT_MUNICIPALITY_ID,
    SOURCE_BENEFIT_FR,
  } from "$lib/onboarding/onboarding-data.js";

  // ── Etape 1 : choix de la municipalite ────────────────────────────────────────
  let selectedMunicipalityId: string = DEFAULT_MUNICIPALITY_ID;
  $: selectedMunicipality =
    QUEBEC_MUNICIPALITIES.find((m) => m.id === selectedMunicipalityId) ??
    QUEBEC_MUNICIPALITIES[0];

  // ── Etape 2 : selection des sources ──────────────────────────────────────────
  let selectedIds: string[] = defaultSelection();

  function toggleSource(id: string) {
    if (selectedIds.includes(id)) {
      selectedIds = selectedIds.filter((s) => s !== id);
    } else {
      selectedIds = [...selectedIds, id];
    }
  }

  // ── Fenetre retro-analyse ──────────────────────────────────────────────────
  const windowOptions = [12, 24, 36];
  let retroWindow: number = RETRO_WINDOW_MONTHS_DEFAULT;

  // Estimation indicative : sources x (fenetre/12) x 8 signaux/source/an
  const SIGNAL_RATE_PER_SOURCE_PER_YEAR = 8;
  $: estimatedSignals =
    selectedIds.length * (retroWindow / 12) * SIGNAL_RATE_PER_SOURCE_PER_YEAR;

  // ── Groupes par recommandation ─────────────────────────────────────────────
  const groups = groupByRecommendation();

  // ── CTA / recap ───────────────────────────────────────────────────────────
  let showSummary = false;
  $: summary = summarize(selectedIds);

  function badgeTone(rec: RecommendationKind): "success" | "warning" | "neutral" | "error" | "info" {
    if (rec === "build-now") return "success";
    if (rec === "qualify-access-now") return "warning";
    if (rec === "build-later") return "neutral";
    if (rec === "manual-check") return "info";
    return "error";
  }
</script>

<section class="min-h-full bg-slate-50 p-6">
  <!-- En-tete ---------------------------------------------------------------->
  <header class="mb-6">
    <p class="text-xs font-medium uppercase tracking-normal text-teal-700">
      Onboarding
    </p>
    <h1 class="mt-1 text-2xl font-semibold tracking-normal text-slate-950">
      Onboarding : {selectedMunicipality.name}
    </h1>
    <p class="mt-1 text-sm text-slate-500">
      Configurez les sources a activer pour la municipalite, puis lancez la
      retro-analyse initiale : cela peuplera le radar avec les signaux historiques
      avant que les scans quotidiens ne prennent le relais.
    </p>
  </header>

  <!-- Etape 1 : choix de la municipalite -------------------------------------->
  <div class="mb-8 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
    <h2 class="mb-4 text-base font-semibold text-slate-950">
      Etape 1 : choisir la municipalite
    </h2>
    <div class="max-w-xs">
      <Select
        id="municipality-select"
        label="Municipalite cible"
        bind:value={selectedMunicipalityId}
      >
        {#each QUEBEC_MUNICIPALITIES as municipality}
          <option value={municipality.id}>{municipality.name}</option>
        {/each}
      </Select>
    </div>
    <p class="mt-2 text-xs text-slate-500">
      Ville selectionnee : <strong>{selectedMunicipality.name}</strong>
    </p>
  </div>

  <!-- Etape 2 : sources a activer -------------------------------------------->
  <div class="mb-8">
    <h2 class="mb-4 text-base font-semibold text-slate-950">
      Etape 2 : sources a activer pour {selectedMunicipality.name}
    </h2>
    <div class="space-y-5">
      {#each groups as group}
        <Card>
          <!-- En-tete du groupe -->
          <div class="flex items-center gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3">
            <Badge tone={badgeTone(group.recommendation)}>
              {RECOMMENDATION_LABELS_FR[group.recommendation]}
            </Badge>
            <span class="text-xs text-slate-500">
              {group.sources.length} source{group.sources.length > 1 ? "s" : ""}
            </span>
          </div>

          <!-- Liste des sources -->
          <div class="divide-y divide-slate-100">
            {#each group.sources as source}
              {@const checked = selectedIds.includes(source.id)}
              <div class="flex items-start gap-4 px-4 py-4">
                <!-- Toggle -->
                <div class="shrink-0 pt-0.5">
                  <Switch
                    id={`source-${source.id}`}
                    label="Activer pour cette ville"
                    {checked}
                    onchange={() => toggleSource(source.id)}
                  />
                </div>

                <!-- Infos source -->
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-semibold text-slate-950">{source.name}</p>
                  <p class="mt-1 text-xs text-slate-600">
                    {SOURCE_BENEFIT_FR[source.id] ?? "Source de donnees pour la detection de signaux."}
                  </p>
                  <!-- Tags complementaires -->
                  <div class="mt-2 flex flex-wrap gap-1.5">
                    <Badge tone={badgeTone(source.recommendation)}>
                      {RECOMMENDATION_LABELS_FR[source.recommendation]}
                    </Badge>
                    {#each source.visionAlignment.slice(0, 2) as alignment}
                      <Badge tone="neutral">
                        {VISION_ALIGNMENT_LABELS_FR[alignment]}
                      </Badge>
                    {/each}
                  </div>
                </div>
              </div>
            {/each}
          </div>
        </Card>
      {/each}
    </div>
  </div>

  <!-- Panneau retro-analyse -------------------------------------------------->
  <div class="mb-8 rounded-lg border border-teal-200 bg-teal-50 p-5 shadow-sm">
    <div class="mb-3 flex items-center gap-2">
      <Info class="h-4 w-4 shrink-0 text-teal-700" aria-hidden="true" />
      <h2 class="text-base font-semibold text-slate-950">Retro-analyse initiale</h2>
    </div>
    <p class="mb-4 text-sm text-slate-600">
      L'onboarding commence par une retro-analyse historique : toutes les sources
      selectionnees sont parcourues sur la fenetre choisie pour reconstituer les
      signaux passes. Les scans quotidiens prennent ensuite le relais automatiquement.
    </p>

    <!-- Selecteur de fenetre -->
    <div class="mb-4 flex flex-wrap items-center gap-3">
      <label for="retro-window" class="text-sm font-medium text-slate-700">
        Fenetre retro-analyse :
      </label>
      <select
        id="retro-window"
        bind:value={retroWindow}
        class="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-300"
      >
        {#each windowOptions as months}
          <option value={months}>{months} mois</option>
        {/each}
      </select>
      <span class="text-xs text-slate-500">
        (defaut : {RETRO_WINDOW_MONTHS_DEFAULT} mois)
      </span>
    </div>

    <!-- Estimation indicative -->
    <div class="rounded-md border border-teal-300 bg-white px-4 py-3">
      <p class="text-xs font-semibold uppercase tracking-wide text-teal-700">
        Estimation indicative
      </p>
      <p class="mt-1 text-2xl font-bold text-slate-950">
        ~{Math.round(estimatedSignals).toLocaleString("fr-CA")} signaux
      </p>
      <p class="mt-0.5 text-xs text-slate-500">
        {selectedIds.length} source{selectedIds.length !== 1 ? "s" : ""} x
        {retroWindow} mois, estimation illustrative uniquement, non garantie.
        Le volume reel depend de l'activite de chaque source.
      </p>
    </div>

    <p class="mt-3 text-xs text-slate-500">
      Apres la retro-analyse, chaque source activee passe en
      <span class="font-semibold text-teal-700">scan quotidien</span> automatique.
    </p>
  </div>

  <!-- Recap de configuration (visible en permanence) ------------------------->
  <div class="mb-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
    <h3 class="mb-3 text-sm font-semibold text-slate-700">Recap de configuration</h3>
    <dl class="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <div class="rounded-md bg-slate-50 p-3">
        <dt class="text-xs text-slate-500">Ville</dt>
        <dd class="mt-1 text-sm font-bold text-teal-800">{selectedMunicipality.name}</dd>
      </div>
      <div class="rounded-md bg-slate-50 p-3">
        <dt class="text-xs text-slate-500">Sources activees</dt>
        <dd class="mt-1 text-2xl font-bold text-teal-800">{selectedIds.length}</dd>
      </div>
      <div class="rounded-md bg-slate-50 p-3">
        <dt class="text-xs text-slate-500">Fenetre retro-analyse</dt>
        <dd class="mt-1 text-2xl font-bold text-teal-800">{retroWindow} mois</dd>
      </div>
    </dl>
    {#if selectedIds.length === 0}
      <p class="mt-2 text-xs text-rose-600">
        Activez au moins une source pour continuer.
      </p>
    {/if}
  </div>

  <!-- CTA ------------------------------------------------------------------->
  <div class="mb-6">
    <button
      type="button"
      class="flex items-center gap-2 rounded-lg bg-teal-700 px-6 py-3 text-sm font-semibold text-white shadow transition hover:bg-teal-800 focus:outline-none focus:ring-2 focus:ring-teal-400 disabled:opacity-50"
      disabled={selectedIds.length === 0}
      on:click={() => { showSummary = !showSummary; }}
    >
      <PlayCircle class="h-4 w-4" aria-hidden="true" />
      Lancer l'onboarding
    </button>
  </div>

  <!-- Recapitulatif de confirmation (demo stub) ------------------------------>
  {#if showSummary}
    <div class="rounded-lg border border-amber-300 bg-amber-50 p-5 shadow-sm">
      <!-- Disclaimer demo -->
      <Alert
        tone="warning"
        title="Demo : aucune ingestion reelle n'est declenchee (orchestration des jobs : EV6/EV7)."
        class="mb-4"
      />

      <h2 class="mb-3 text-base font-semibold text-slate-950">
        Recapitulatif de l'onboarding
      </h2>

      <!-- Total + ville + fenetre -->
      <dl class="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div class="rounded-md bg-white p-3 shadow-sm">
          <dt class="text-xs text-slate-500">Ville</dt>
          <dd class="mt-1 text-sm font-bold text-teal-800">{selectedMunicipality.name}</dd>
        </div>
        <div class="rounded-md bg-white p-3 shadow-sm">
          <dt class="text-xs text-slate-500">Sources selectionnees</dt>
          <dd class="mt-1 text-2xl font-bold text-teal-800">{summary.total}</dd>
        </div>
        <div class="rounded-md bg-white p-3 shadow-sm">
          <dt class="text-xs text-slate-500">Fenetre retro-analyse</dt>
          <dd class="mt-1 text-2xl font-bold text-teal-800">{retroWindow} mois</dd>
        </div>
        <div class="rounded-md bg-white p-3 shadow-sm">
          <dt class="text-xs text-slate-500">Signaux estimes (indicatif)</dt>
          <dd class="mt-1 text-2xl font-bold text-slate-700">
            ~{Math.round(estimatedSignals).toLocaleString("fr-CA")}
          </dd>
        </div>
      </dl>

      <!-- Repartition par recommandation -->
      <h3 class="mb-2 text-sm font-semibold text-slate-700">
        Repartition par categorie
      </h3>
      <ul class="space-y-1.5">
        {#each Object.entries(summary.byRecommendation) as [rec, count]}
          <li class="flex items-center gap-2">
            <Badge tone={badgeTone(rec as RecommendationKind)}>
              {RECOMMENDATION_LABELS_FR[rec as RecommendationKind] ?? rec}
            </Badge>
            <span class="text-sm font-semibold text-slate-950">{count}</span>
            <span class="text-xs text-slate-500">
              source{count !== 1 ? "s" : ""}
            </span>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</section>
