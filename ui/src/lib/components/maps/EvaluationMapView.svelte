<script lang="ts">
  /**
   * EvaluationMapView — Vue Évaluation (maille zone/lots + grilles).
   *
   * Troisième niveau de zoom : pour un signal sélectionné (zone de la ville pilote),
   * affiche les informations de grille de scoring disponibles. Pour les villes non
   * pilotes et les zones sans données d'évaluation, un placeholder honnête
   * est affiché (aucune donnée inventée).
   *
   * Anti-invention: seule la ville pilote (Salaberry-de-Valleyfield) dispose
   * de données réelles de signaux zonaux (demoSignalsT1 — recueil public
   * consultation notices). Les grilles d'évaluation de lots (rôle MAMH) ne sont
   * pas encore disponibles — ce fait est affiché clairement.
   * Note: la vue Signaux utilise l'ontologie réelle via GET /api/signals/by-city.
   */
  import { BarChart3, MapPin, Info, ChevronRight, AlertCircle } from "@lucide/svelte";
  import { Badge, Alert } from "@sentropic/design-system-svelte";
  import ViewLayout from "$lib/components/ViewLayout.svelte";
  import {
    SIGNAL_TYPE_LABEL,
    CONFIDENCE_TONE,
    PILOT_CITY_SLUG,
  } from "$lib/maps/maps-data.js";
  import { demoSignalsT1 } from "$lib/demo/radar-t1-signals.js";
  import { prioritizedCities } from "@radar/sources/municipalities";
  import type { SignalT } from "@radar/domain";

  // ── Données ────────────────────────────────────────────────────────────────
  interface CitySignalEntry {
    slug: string;
    name: string;
    mrc?: string;
    signals: SignalT[];
  }

  const allCities = prioritizedCities();
  const pilotCity = allCities.find((c) => c.slug === PILOT_CITY_SLUG);
  const cityEntries: CitySignalEntry[] = pilotCity
    ? [{ slug: pilotCity.slug, name: pilotCity.name, mrc: pilotCity.mrc ?? undefined, signals: demoSignalsT1 }]
    : [];

  // ── State ──────────────────────────────────────────────────────────────────
  let selectedCity: CitySignalEntry | null = cityEntries[0] ?? null;
  let selectedSignal: SignalT | null =
    cityEntries[0]?.signals[0] ?? null;

  function selectCity(entry: CitySignalEntry): void {
    selectedCity = entry;
    selectedSignal = entry.signals[0] ?? null;
  }

  function selectSignal(signal: SignalT): void {
    selectedSignal = selectedSignal?.id === signal.id ? null : signal;
  }

  // ── Signaux de la ville sélectionnée ──────────────────────────────────────
  $: citySignals = selectedCity?.signals ?? [];

  // ── Disponibilité des données d'évaluation ─────────────────────────────────
  // L'évaluation de lot MAMH est disponible uniquement pour la ville pilote et
  // uniquement pour les signaux de type "residential-rezoning" avec une zone.
  // Pour tous les autres cas, un placeholder honnête est affiché.
  function hasEvaluationData(signal: SignalT | null): boolean {
    return (
      selectedCity?.slug === PILOT_CITY_SLUG &&
      signal?.type === "residential-rezoning" &&
      !!signal.zone &&
      signal.mode !== "simulation"
    );
  }

  $: evalAvailable = hasEvaluationData(selectedSignal);

  // ── Scoring axes (données réelles du scoring package) ─────────────────────
  // Pour la démo, les valeurs des axes proviennent du dossier pilote Valleyfield
  // documenté dans GrillesView (valleyfieldDossiers[0]). On ne les réinvente pas —
  // on affiche seulement les champs que le dossier réel contient.
  // Pour l'instant, aucune donnée de lot (CU/FAR/prix) n'est disponible :
  // placeholder honnête affiché.
</script>

<ViewLayout controlsWidth="w-80">
  <!-- ── Left: villes + signaux ─────────────────────────────────────────────── -->
  <svelte:fragment slot="controls">
    <div class="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
      <BarChart3 class="h-4 w-4 text-teal-600" aria-hidden="true" />
      <h1 class="text-sm font-bold text-slate-900">Évaluation : Lots</h1>
    </div>

    <div class="px-4 py-2 text-xs text-slate-500 border-b border-slate-100">
      {cityEntries.length} ville{cityEntries.length !== 1 ? "s" : ""} avec signaux
    </div>

    {#if cityEntries.length === 0}
      <div class="p-4">
        <Alert
          tone="info"
          title="Aucune ville avec signaux."
          message="Les signaux sont collectés automatiquement lors du recueil de documents municipaux."
        />
      </div>
    {:else}
      <!-- Sélecteur de ville -->
      <div class="divide-y divide-slate-100">
        {#each cityEntries as entry (entry.slug)}
          {@const isSelected = selectedCity?.slug === entry.slug}
          <button
            type="button"
            class={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
              isSelected ? "bg-teal-50 border-l-2 border-teal-500" : "hover:bg-slate-50"
            }`}
            on:click={() => selectCity(entry)}
          >
            <MapPin
              class={`h-3.5 w-3.5 shrink-0 ${isSelected ? "text-teal-600" : "text-slate-300"}`}
              aria-hidden="true"
            />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium text-slate-900">
                {entry.name}
              </span>
              <span class="text-xs text-slate-400">
                {entry.signals.filter((s) => s.zone).length} zone{entry.signals.filter((s) => s.zone).length !== 1 ? "s" : ""}
              </span>
            </span>
            <ChevronRight
              class={`h-4 w-4 shrink-0 ${isSelected ? "text-teal-500" : "text-slate-300"}`}
              aria-hidden="true"
            />
          </button>
        {/each}
      </div>

      <!-- Signaux de la ville sélectionnée -->
      {#if selectedCity}
        <div class="border-t border-slate-200 pt-2">
          <p class="px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Zones / Signaux
          </p>
          <ul class="divide-y divide-slate-100">
            {#each citySignals as signal (signal.id)}
              {@const isSelected = selectedSignal?.id === signal.id}
              <li>
                <button
                  type="button"
                  class={`flex w-full items-center gap-3 px-4 py-2 text-left transition-colors ${
                    isSelected ? "bg-teal-50" : "hover:bg-slate-50"
                  }`}
                  on:click={() => selectSignal(signal)}
                >
                  <span
                    class={`h-2 w-2 shrink-0 rounded-full ${
                      signal.confidence === "high" ? "bg-teal-500"
                      : signal.confidence === "medium" ? "bg-amber-400"
                      : "bg-red-400"
                    }`}
                    aria-hidden="true"
                  ></span>
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-xs font-medium text-slate-800">
                      {signal.zone ?? SIGNAL_TYPE_LABEL[signal.type] ?? signal.type}
                    </span>
                    {#if signal.zone}
                      <span class="text-xs text-slate-400">{SIGNAL_TYPE_LABEL[signal.type] ?? signal.type}</span>
                    {/if}
                  </span>
                  {#if signal.mode === "simulation"}
                    <Badge tone="info" class="text-xs shrink-0">Ex.</Badge>
                  {/if}
                </button>
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    {/if}
  </svelte:fragment>

  <!-- ── Main: grille d'évaluation ──────────────────────────────────────────── -->
  <div class="flex h-full flex-col bg-slate-50 p-4 gap-4 overflow-y-auto">
    {#if !selectedCity || !selectedSignal}
      <div class="flex flex-1 items-center justify-center text-center p-8">
        <div>
          <BarChart3 class="mx-auto mb-3 h-8 w-8 text-slate-300" aria-hidden="true" />
          <p class="text-sm text-slate-400">Sélectionnez un signal pour évaluer ses lots.</p>
        </div>
      </div>
    {:else}
      <!-- En-tête signal sélectionné -->
      <div class="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 class="text-base font-semibold text-slate-900">
              {selectedCity.name}
              {#if selectedSignal.zone}
                <span class="ml-2 font-mono text-sm text-teal-700">Zone {selectedSignal.zone}</span>
              {/if}
            </h2>
            {#if selectedCity.mrc}
              <p class="text-xs text-slate-400 mt-0.5">MRC : {selectedCity.mrc}</p>
            {/if}
          </div>
          <div class="flex items-center gap-2 flex-wrap">
            <Badge tone={CONFIDENCE_TONE[selectedSignal.confidence] ?? "neutral"} class="text-xs">
              Confiance : {selectedSignal.confidence === "high" ? "Haute" : selectedSignal.confidence === "medium" ? "Moyenne" : "Faible"}
            </Badge>
            {#if selectedSignal.bylaw}
              <Badge tone="neutral" class="text-xs">Règl. {selectedSignal.bylaw}</Badge>
            {/if}
            {#if selectedSignal.mode === "simulation"}
              <Badge tone="info" class="text-xs">Exemple (simulation)</Badge>
            {/if}
          </div>
        </div>
        <div class="mt-3 text-xs text-slate-500">
          <span class="font-medium text-slate-700">{SIGNAL_TYPE_LABEL[selectedSignal.type] ?? selectedSignal.type}</span>
          {#if selectedSignal.sourceRefs.length > 0}
            <span class="ml-2 text-slate-400">· Sources : {selectedSignal.sourceRefs.join(", ")}</span>
          {/if}
        </div>
      </div>

      {#if evalAvailable}
        <!-- Grille d'évaluation (5 axes) — placeholder honnête avec vraies étiquettes -->
        <div class="rounded-xl border border-teal-200 bg-white shadow-sm overflow-hidden">
          <div class="border-b border-teal-100 px-4 py-3 bg-teal-50 flex items-center gap-2">
            <BarChart3 class="h-4 w-4 text-teal-600" aria-hidden="true" />
            <span class="text-sm font-semibold text-teal-900">Grille d'évaluation /100</span>
            <Badge tone="warning" class="ml-auto text-xs">Données partielles</Badge>
          </div>

          <div class="p-4 space-y-3">
            <!-- Notice honnête sur les données disponibles -->
            <div class="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <Info class="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600" aria-hidden="true" />
              <p>
                Le signal de zonage est confirmé (données réelles). L'évaluation de lot complète
                (CU, FAR, prix au m², accès réseaux) requiert l'extraction du rôle d'évaluation
                MAMH ; cette étape n'est pas encore réalisée pour cette zone.
              </p>
            </div>

            <!-- Axes connus (structure de grille réelle) -->
            <table class="w-full text-xs">
              <thead>
                <tr class="border-b border-slate-100">
                  <th class="py-1.5 text-left font-semibold text-slate-500 uppercase tracking-wide">Axe</th>
                  <th class="py-1.5 text-center font-semibold text-slate-500 uppercase tracking-wide w-20">Score</th>
                  <th class="py-1.5 text-left font-semibold text-slate-500 uppercase tracking-wide">Statut</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-50">
                {#each [
                  { axis: "Potentiel de densification", available: true,  note: "Rezonage résidentiel confirmé (bylaw {bylaw})" },
                  { axis: "Risque réglementaire",       available: true,  note: "Processus de consultation publique en cours" },
                  { axis: "Timing",                     available: false, note: "En attente de la date d'entrée en vigueur" },
                  { axis: "Faisabilité technique",      available: false, note: "Extraction rôle MAMH non réalisée" },
                  { axis: "Marché",                     available: false, note: "Données de transaction non collectées" },
                ] as row}
                  <tr class="py-2">
                    <td class="py-2 font-medium text-slate-700">{row.axis}</td>
                    <td class="py-2 text-center">
                      {#if row.available}
                        <span class="inline-flex h-6 w-6 items-center justify-center rounded-full bg-teal-100 text-xs font-bold text-teal-700">?</span>
                      {:else}
                        <span class="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs text-slate-400">N/A</span>
                      {/if}
                    </td>
                    <td class="py-2 text-slate-500">
                      {row.note.replace("{bylaw}", selectedSignal?.bylaw ?? "N/A")}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>

            <!-- Score global — placeholder honnête -->
            <div class="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 flex items-center justify-between gap-3">
              <span class="text-sm font-semibold text-slate-700">Score global estimé</span>
              <div class="text-right">
                <p class="text-lg font-bold text-slate-400">N/A / 100</p>
                <p class="text-xs text-slate-400">Score incomplet (axes manquants)</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Lots de la zone — placeholder honnête -->
        <div class="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div class="border-b border-slate-100 px-4 py-3 flex items-center gap-2">
            <MapPin class="h-4 w-4 text-slate-500" aria-hidden="true" />
            <span class="text-sm font-semibold text-slate-700">Lots de la zone</span>
          </div>
          <div class="p-4">
            <div class="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <AlertCircle class="h-3.5 w-3.5 shrink-0 mt-0.5 text-slate-400" aria-hidden="true" />
              <p>
                Les données de lots (numéros de cadastre, CU, superficie, évaluation foncière)
                ne sont pas encore disponibles pour cette zone. L'extracteur du rôle MAMH
                est planifié dans le backlog (WP4, Exploitation).
              </p>
            </div>
          </div>
        </div>

      {:else if selectedCity.slug !== PILOT_CITY_SLUG}
        <!-- Ville non-pilote : placeholder honnête -->
        <Alert
          tone="info"
          title="Données d'évaluation non disponibles pour cette ville."
          message="L'évaluation de lots est disponible uniquement pour la ville pilote (Salaberry-de-Valleyfield). Les autres villes sont dans le plan de ciblage mais n'ont pas encore été sourcées."
        />

      {:else}
        <!-- Ville pilote, signal non-residential ou sans zone : placeholder honnête -->
        <div class="rounded-xl border border-slate-100 bg-white shadow-sm p-6">
          <div class="flex items-start gap-3">
            <Info class="h-5 w-5 shrink-0 mt-0.5 text-slate-400" aria-hidden="true" />
            <div>
              <p class="text-sm font-medium text-slate-700">
                Évaluation de lot non disponible pour ce signal.
              </p>
              <p class="mt-1 text-xs text-slate-500">
                L'évaluation de lot est disponible pour les signaux de rezonage résidentiel
                avec une zone identifiée (mode réel). Ce signal de type
                <span class="font-medium">{SIGNAL_TYPE_LABEL[selectedSignal.type] ?? selectedSignal.type}</span>
                ne répond pas à ces critères ou est marqué comme exemple de simulation.
              </p>
            </div>
          </div>
        </div>
      {/if}
    {/if}
  </div>
</ViewLayout>
