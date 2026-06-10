<script lang="ts">
  /**
   * OpportunitesMapView — Vue Opportunités (maille ville/zones).
   *
   * Vue intermédiaire : liste les opportunités (signaux à approfondir) par ville,
   * avec zoom sur zone. Données réelles : 3 signaux pilot Valleyfield (demoSignalsT1).
   * Autres villes : placeholder honnête (0 opportunités).
   *
   * Anti-invention: aucune opportunité synthétique sans marquage "Exemple (simulation)".
   * Note: cette vue conserve les signaux demoSignalsT1 (le recueil de documents de
   * la ville pilote produit ces 3 signaux réels + 3 simulations de fixture). La vue
   * Signaux utilise l'ontologie réelle via GET /api/signals/by-city.
   */
  import { Building2, MapPin, ChevronRight, Info } from "@lucide/svelte";
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
  // Only show cities that have at least 1 signal in the left panel.
  // Currently only the pilot city (salaberry-de-valleyfield) has signals.
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
  let selectedSignal: SignalT | null = null;

  function selectCity(entry: CitySignalEntry): void {
    selectedCity = entry;
    selectedSignal = null;
  }

  function selectSignal(signal: SignalT): void {
    selectedSignal = selectedSignal?.id === signal.id ? null : signal;
  }

  // ── Signaux filtrés par ville ──────────────────────────────────────────────
  $: citySignals = selectedCity?.signals ?? [];
  $: toApprofondir = citySignals.filter((s) => s.status === "à-approfondir");
  $: otherSignals = citySignals.filter((s) => s.status !== "à-approfondir");
</script>

<ViewLayout controlsWidth="w-80">
  <!-- ── Left: villes avec signaux ─────────────────────────────────────────── -->
  <svelte:fragment slot="controls">
    <div class="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
      <Building2 class="h-4 w-4 text-teal-600" aria-hidden="true" />
      <h1 class="text-sm font-bold text-slate-900">Opportunités : Zones</h1>
    </div>

    <div class="px-4 py-2 text-xs text-slate-500 border-b border-slate-100">
      {cityEntries.length} ville{cityEntries.length !== 1 ? "s" : ""} avec signaux actifs
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
      <ul class="divide-y divide-slate-100">
        {#each cityEntries as entry (entry.slug)}
          {@const isSelected = selectedCity?.slug === entry.slug}
          <li>
            <button
              type="button"
              class={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${
                isSelected ? "bg-teal-50 border-l-2 border-teal-500" : "hover:bg-slate-50"
              }`}
              on:click={() => selectCity(entry)}
            >
              <MapPin
                class={`h-3.5 w-3.5 shrink-0 ${isSelected ? "text-teal-600" : "text-slate-400"}`}
                aria-hidden="true"
              />
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-medium text-slate-900">
                  {entry.name}
                </span>
                <span class="text-xs text-slate-400">
                  {entry.signals.filter((s) => s.status === "à-approfondir").length} à approfondir
                </span>
              </span>
              <ChevronRight
                class={`h-4 w-4 shrink-0 ${isSelected ? "text-teal-500" : "text-slate-300"}`}
                aria-hidden="true"
              />
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </svelte:fragment>

  <!-- ── Main: zones / signaux pour la ville sélectionnée ──────────────────── -->
  <div class="flex h-full flex-col bg-slate-50 p-4 gap-4 overflow-y-auto">
    {#if !selectedCity}
      <div class="flex flex-1 items-center justify-center text-center p-8">
        <div>
          <Building2 class="mx-auto mb-3 h-8 w-8 text-slate-300" aria-hidden="true" />
          <p class="text-sm text-slate-400">Sélectionnez une ville pour explorer ses zones.</p>
        </div>
      </div>
    {:else}
      <!-- En-tête ville -->
      <div class="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <h2 class="text-base font-semibold text-slate-900">{selectedCity.name}</h2>
        {#if selectedCity.mrc}
          <p class="text-xs text-slate-400 mt-0.5">MRC : {selectedCity.mrc}</p>
        {/if}
        <div class="mt-2 flex items-center gap-3 text-xs text-slate-500">
          <span>
            <strong class="text-slate-700">{toApprofondir.length}</strong> signal{toApprofondir.length !== 1 ? "s" : ""} à approfondir
          </span>
          <span class="text-slate-300">·</span>
          <span>
            <strong class="text-slate-700">{citySignals.length}</strong> total
          </span>
          {#if selectedCity.slug === PILOT_CITY_SLUG}
            <Badge tone="success" class="text-xs">Ville pilote</Badge>
          {/if}
        </div>
      </div>

      <!-- Signaux à approfondir -->
      {#if toApprofondir.length > 0}
        <div>
          <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-teal-600 px-1">
            À approfondir
          </h3>
          <ul class="space-y-2">
            {#each toApprofondir as signal (signal.id)}
              {@const isExpanded = selectedSignal?.id === signal.id}
              <li>
                <button
                  type="button"
                  class={`w-full rounded-xl border text-left transition-all ${
                    isExpanded
                      ? "border-teal-300 bg-teal-50 shadow-sm"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm"
                  } px-4 py-3`}
                  on:click={() => selectSignal(signal)}
                >
                  <div class="flex items-center justify-between gap-3">
                    <div class="flex items-center gap-2 flex-wrap">
                      <span class={`h-2 w-2 rounded-full shrink-0 ${
                        signal.confidence === "high" ? "bg-teal-500"
                        : signal.confidence === "medium" ? "bg-amber-400"
                        : "bg-red-400"
                      }`} aria-hidden="true"></span>
                      <span class="text-sm font-medium text-slate-800">
                        {SIGNAL_TYPE_LABEL[signal.type] ?? signal.type}
                      </span>
                      {#if signal.bylaw}
                        <Badge tone="neutral" class="text-xs">Règl. {signal.bylaw}</Badge>
                      {/if}
                      {#if signal.mode === "simulation"}
                        <Badge tone="info" class="text-xs">Exemple (simulation)</Badge>
                      {/if}
                    </div>
                    <ChevronRight
                      class={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                      aria-hidden="true"
                    />
                  </div>

                  {#if signal.zone}
                    <p class="mt-1 text-xs font-mono text-teal-700">
                      Zone : {signal.zone}
                    </p>
                  {/if}

                  <!-- Zone détail (déplié) -->
                  {#if isExpanded}
                    <div class="mt-3 border-t border-teal-100 pt-3 space-y-1.5">
                      <div class="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <p class="text-slate-400">Type</p>
                          <p class="text-slate-700 font-medium">{SIGNAL_TYPE_LABEL[signal.type] ?? signal.type}</p>
                        </div>
                        <div>
                          <p class="text-slate-400">Confiance</p>
                          <p class={`font-medium ${
                            signal.confidence === "high" ? "text-teal-700"
                            : signal.confidence === "medium" ? "text-amber-600"
                            : "text-red-600"
                          }`}>{signal.confidence === "high" ? "Haute" : signal.confidence === "medium" ? "Moyenne" : "Faible"}</p>
                        </div>
                        <div>
                          <p class="text-slate-400">Détecté</p>
                          <p class="text-slate-700">{signal.detectedAt}</p>
                        </div>
                        <div>
                          <p class="text-slate-400">Statut</p>
                          <p class="text-slate-700">{signal.status}</p>
                        </div>
                      </div>

                      {#if signal.sourceRefs.length > 0}
                        <div class="text-xs">
                          <p class="text-slate-400 mb-0.5">Sources</p>
                          {#each signal.sourceRefs as ref}
                            <p class="font-mono text-slate-600">{ref}</p>
                          {/each}
                        </div>
                      {/if}

                      <!-- Placeholder évaluation de lot — honnête -->
                      <div class="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 flex items-start gap-2">
                        <Info class="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600" aria-hidden="true" />
                        <p>
                          <strong>Évaluation de lot</strong> disponible dans la Vue Évaluation.
                          Les lots de la zone {signal.zone ?? "N/A"} nécessitent
                          l'extraction du rôle d'évaluation MAMH (données disponibles
                          pour la ville pilote).
                        </p>
                      </div>
                    </div>
                  {/if}
                </button>
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      <!-- Autres signaux -->
      {#if otherSignals.length > 0}
        <div>
          <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 px-1">
            Autres signaux
          </h3>
          <ul class="space-y-2">
            {#each otherSignals as signal (signal.id)}
              <li class="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
                <span
                  class={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
                    signal.confidence === "high" ? "bg-teal-400"
                    : signal.confidence === "medium" ? "bg-amber-300"
                    : "bg-red-300"
                  }`}
                  aria-hidden="true"
                ></span>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="text-sm text-slate-700">{SIGNAL_TYPE_LABEL[signal.type] ?? signal.type}</span>
                    {#if signal.zone}
                      <Badge tone="neutral" class="text-xs font-mono">{signal.zone}</Badge>
                    {/if}
                    {#if signal.mode === "simulation"}
                      <Badge tone="info" class="text-xs">Exemple</Badge>
                    {/if}
                  </div>
                  <p class="text-xs text-slate-400 mt-0.5">Statut : {signal.status}</p>
                </div>
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    {/if}
  </div>
</ViewLayout>
