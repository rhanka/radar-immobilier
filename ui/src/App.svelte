<script lang="ts">
  import { onMount } from "svelte";
  import { ThemeProvider } from "@sentropic/design-system-svelte";
  import { sentTechTheme } from "@sentropic/design-system-themes";
  import { readHealth, type HealthView } from "$lib/api/health";
  import AppShell from "$lib/components/AppShell.svelte";
  import NavMenu from "$lib/components/NavMenu.svelte";
  import type { DemoView } from "$lib/demo/views";
  import BenchmarkComparison from "$lib/components/comparison/BenchmarkComparison.svelte";
  import SourceReviewShell from "$lib/components/source-review/SourceReviewShell.svelte";
  import OpportunityFunnel from "$lib/components/opportunity/OpportunityFunnel.svelte";
  import GrillesView from "$lib/components/scoring/GrillesView.svelte";
  import { demoOpportunity, demoSignals } from "$lib/demo/radar-demo-data";
  import { createDashboardState } from "$lib/state/dashboard";

  let activeView: DemoView = "radar";
  let selectedSignalId = demoSignals[0]?.id;
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
  <div class="flex h-screen flex-col">
    <NavMenu {activeView} onSelect={(view) => (activeView = view)} />
    <div class="min-h-0 flex-1 overflow-auto">
      {#if activeView === "radar"}
        <AppShell
          {dashboard}
          {health}
          onSelectSignal={(signalId) => {
            selectedSignalId = signalId;
          }}
        />
      {:else if activeView === "comparison"}
        <BenchmarkComparison />
      {:else if activeView === "opportunity"}
        <OpportunityFunnel />
      {:else if activeView === "grilles"}
        <GrillesView />
      {:else}
        <SourceReviewShell onBackToRadar={() => (activeView = "radar")} />
      {/if}
    </div>
  </div>
</ThemeProvider>
