<script lang="ts">
  /**
   * SourceMapView — vue « Source » (qualité de données e2e), shell à 2 onglets.
   *
   * Remplace l'ancienne vue Sources liste (SourcesMapView) ET l'ancienne Console
   * sources. Deux onglets sur le MÊME endpoint /api/source/coverage (une seule
   * requête, partagée) :
   *   - « Couverture » : carte choroplèthe (socle GeoCityMapBase) colorée par le
   *     pire statut honnête + scorecard au clic + headline province + focus-30.
   *   - « Console »     : table tri-état par ville (reconstruite sur le vrai
   *     endpoint ; l'ancienne Console est supprimée).
   *
   * Deep-link : la route legacy `#/console` monte cette vue avec l'onglet
   * « Console » pré-sélectionné (App.svelte passe initialTab="console").
   */
  import { onMount } from "svelte";
  import SourceCoverageMap from "./SourceCoverageMap.svelte";
  import SourceConsole from "./SourceConsole.svelte";
  import {
    fetchSourceCoverage,
    type CoverageResponse,
  } from "$lib/sources/source-coverage-client.js";

  export let initialTab: "couverture" | "console" = "couverture";
  let activeTab: "couverture" | "console" = initialTab;

  const TABS: { id: "couverture" | "console"; label: string }[] = [
    { id: "couverture", label: "Couverture" },
    { id: "console", label: "Console" },
  ];

  // ── Données partagées (une seule requête couverture) ───────────────────────
  let response: CoverageResponse | null = null;
  let loading = true;
  let error: string | null = null;

  async function load(): Promise<void> {
    loading = true;
    error = null;
    try {
      response = await fetchSourceCoverage();
    } catch (e) {
      // État d'erreur HONNÊTE : pas de faux zéro, pas de vert fabriqué.
      error = e instanceof Error ? e.message : "Couverture indisponible";
      response = null;
    } finally {
      loading = false;
    }
  }

  $: cities = response?.cities ?? [];

  onMount(() => {
    void load();
  });
</script>

<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
  <!-- ── Onglets : Couverture | Console ────────────────────────────────────── -->
  <div class="shrink-0 border-b border-slate-200 bg-white px-4">
    <div class="flex gap-1" role="tablist" aria-label="Vues Source">
      {#each TABS as tab (tab.id)}
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === tab.id}
          class={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === tab.id
              ? "border-teal-600 text-teal-700"
              : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
          }`}
          on:click={() => { activeTab = tab.id; }}
        >
          {tab.label}
        </button>
      {/each}
    </div>
  </div>

  {#if activeTab === "console"}
    <SourceConsole {cities} {response} {loading} {error} onReload={load} />
  {:else}
    <SourceCoverageMap {cities} {response} {loading} {error} onReload={load} />
  {/if}
</div>
