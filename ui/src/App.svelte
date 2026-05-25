<script lang="ts">
  import { onMount } from "svelte";
  import { ThemeProvider } from "@sentropic/design-system-svelte";
  import { sentTechTheme } from "@sentropic/design-system-themes";
  import { readHealth, type HealthView } from "$lib/api/health";
  import AppShell from "$lib/components/AppShell.svelte";
  import SourceReviewShell from "$lib/components/source-review/SourceReviewShell.svelte";
  import { demoOpportunity, demoSignals } from "$lib/demo/radar-demo-data";
  import { createDashboardState } from "$lib/state/dashboard";

  let selectedSignalId = demoSignals[0]?.id;
  let activeView: "source-review" | "radar" = "source-review";
  let health: HealthView = {
    kind: "offline",
    label: "API en attente",
    detail: "Verification en cours",
  };

  $: dashboard = createDashboardState(
    demoSignals,
    demoOpportunity,
    selectedSignalId,
  );

  onMount(async () => {
    health = await readHealth();
  });
</script>

<ThemeProvider theme={sentTechTheme}>
  {#if activeView === "source-review"}
    <SourceReviewShell
      onBackToRadar={() => {
        activeView = "radar";
      }}
    />
  {:else}
    <div class="fixed right-4 top-4 z-50">
      <button
        type="button"
        class="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:border-teal-500"
        on:click={() => {
          activeView = "source-review";
        }}
      >
        Revue sources
      </button>
    </div>
    <AppShell
      {dashboard}
      {health}
      onSelectSignal={(signalId) => {
        selectedSignalId = signalId;
      }}
    />
  {/if}
</ThemeProvider>
