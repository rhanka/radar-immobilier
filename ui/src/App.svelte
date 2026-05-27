<script lang="ts">
  import { onMount } from "svelte";
  import { ThemeProvider } from "@sentropic/design-system-svelte";
  import { sentTechTheme } from "@sentropic/design-system-themes";
  import { readHealth, type HealthView } from "$lib/api/health";
  import AppShell from "$lib/components/AppShell.svelte";
  import NavMenu from "$lib/components/NavMenu.svelte";
  import type { DemoView } from "$lib/demo/views";
  import OnboardingView from "$lib/components/onboarding/OnboardingView.svelte";
  import BenchmarkComparison from "$lib/components/comparison/BenchmarkComparison.svelte";
  import SourceReviewShell from "$lib/components/source-review/SourceReviewShell.svelte";
  import OpportunityFunnel from "$lib/components/opportunity/OpportunityFunnel.svelte";
  import GrillesView from "$lib/components/scoring/GrillesView.svelte";
  import CoordinationView from "$lib/components/coordination/CoordinationView.svelte";
  import ConsoleView from "$lib/components/console/ConsoleView.svelte";
  import AutomationView from "$lib/components/automation/AutomationView.svelte";
  import SignalsT1View from "$lib/components/signals/SignalsT1View.svelte";
  import { demoOpportunity, demoSignals } from "$lib/demo/radar-demo-data";
  import { createDashboardState } from "$lib/state/dashboard";
  import type { SignalT } from "@radar/domain";

  let activeView: DemoView = "radar";
  let selectedSignalId = demoSignals[0]?.id;
  /** Signal id transmis par Approfondir → filtre OpportunityFunnel (T2). */
  let opportuniteSignalId: string | undefined = undefined;
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

  function handleApprofondir(signal: SignalT): void {
    opportuniteSignalId = signal.id;
    activeView = "opportunity";
  }

  onMount(async () => {
    health = await readHealth();
  });
</script>

<ThemeProvider theme={sentTechTheme}>
  <div class="flex h-screen flex-col">
    <NavMenu {activeView} onSelect={(view) => (activeView = view)} />
    <div class="min-h-0 flex-1 overflow-auto">
      {#if activeView === "onboarding"}
        <OnboardingView />
      {:else if activeView === "radar"}
        <AppShell
          {dashboard}
          {health}
          onSelectSignal={(signalId) => {
            selectedSignalId = signalId;
          }}
        />
      {:else if activeView === "signaux"}
        <SignalsT1View onApprofondir={handleApprofondir} />
      {:else if activeView === "comparison"}
        <BenchmarkComparison />
      {:else if activeView === "opportunity"}
        <OpportunityFunnel
          selectedSignalId={opportuniteSignalId}
          onClearFilter={() => (opportuniteSignalId = undefined)}
        />
      {:else if activeView === "grilles"}
        <GrillesView />
      {:else if activeView === "coordination"}
        <CoordinationView />
      {:else if activeView === "console"}
        <ConsoleView />
      {:else if activeView === "automation"}
        <AutomationView />
      {:else}
        <SourceReviewShell onBackToRadar={() => (activeView = "radar")} />
      {/if}
    </div>
  </div>
</ThemeProvider>
