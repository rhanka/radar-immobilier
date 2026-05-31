<script lang="ts">
  import { ThemeProvider } from "@sentropic/design-system-svelte";
  import { sentTechTheme } from "@sentropic/design-system-themes";
  import AppSidebar from "$lib/components/AppSidebar.svelte";
  import type { DemoView } from "$lib/demo/views";
  import OnboardingView from "$lib/components/onboarding/OnboardingView.svelte";
  import OpportunityFunnel from "$lib/components/opportunity/OpportunityFunnel.svelte";
  import GrillesView from "$lib/components/scoring/GrillesView.svelte";
  import ConsoleView from "$lib/components/console/ConsoleView.svelte";
  import AutomationView from "$lib/components/automation/AutomationView.svelte";
  import SignalsT1View from "$lib/components/signals/SignalsT1View.svelte";
  import type { SignalT } from "@radar/domain";

  let activeView: DemoView = "signaux";
  /** Signal id transmis par Approfondir → filtre OpportunityFunnel. */
  let opportuniteSignalId: string | undefined = undefined;

  function handleApprofondir(signal: SignalT): void {
    opportuniteSignalId = signal.id;
    activeView = "opportunity";
  }
</script>

<ThemeProvider theme={sentTechTheme}>
  <div class="flex h-screen overflow-hidden">
    <AppSidebar {activeView} onSelect={(view) => (activeView = view)} />
    <main class="flex-1 min-w-0 overflow-auto">
      {#if activeView === "onboarding"}
        <OnboardingView />
      {:else if activeView === "signaux"}
        <SignalsT1View onApprofondir={handleApprofondir} />
      {:else if activeView === "opportunity"}
        <OpportunityFunnel
          selectedSignalId={opportuniteSignalId}
          onClearFilter={() => (opportuniteSignalId = undefined)}
        />
      {:else if activeView === "grilles"}
        <GrillesView />
      {:else if activeView === "console"}
        <ConsoleView />
      {:else}
        <AutomationView />
      {/if}
    </main>
  </div>
</ThemeProvider>
