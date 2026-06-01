<script lang="ts">
  import { onMount } from "svelte";
  import { ThemeProvider } from "@sentropic/design-system-svelte";
  import { sentTechTheme } from "@sentropic/design-system-themes";
  import AppSidebar from "$lib/components/AppSidebar.svelte";
  import TourOverlay from "$lib/components/tour/TourOverlay.svelte";
  import type { DemoView } from "$lib/demo/views";
  import OnboardingView from "$lib/components/onboarding/OnboardingView.svelte";
  import OpportunityFunnel from "$lib/components/opportunity/OpportunityFunnel.svelte";
  import GrillesView from "$lib/components/scoring/GrillesView.svelte";
  import ConsoleView from "$lib/components/console/ConsoleView.svelte";
  import AutomationView from "$lib/components/automation/AutomationView.svelte";
  import SignalsT1View from "$lib/components/signals/SignalsT1View.svelte";
  import ChatWidgetHost from "$lib/components/chat/ChatWidgetHost.svelte";
  import { chatWidgetLayout } from "$lib/chat/chat-widget-layout";
  import type { SignalT } from "@radar/domain";
  import { tourActive, tourStep, startTour, closeTour, isFirstVisit } from "$lib/state/tour.js";
  import { tourSteps } from "$lib/tour/tour-steps.js";

  let activeView: DemoView = "signaux";
  /** Signal id transmis par Approfondir -> filtre OpportunityFunnel. */
  let opportuniteSignalId: string | undefined = undefined;

  function handleApprofondir(signal: SignalT): void {
    opportuniteSignalId = signal.id;
    activeView = "opportunity";
  }

  // ── Tour ─────────────────────────────────────────────────────────────────
  $: isTourActive = $tourActive;
  $: currentTourStepIndex = $tourStep;

  /**
   * Quand l'index d'etape change (store), on bascule la vue si necessaire.
   * La reaction est conditionnelle pour eviter les mises a jour inutiles.
   */
  $: {
    if (isTourActive) {
      const step = tourSteps[currentTourStepIndex];
      if (step && step.view !== activeView) {
        activeView = step.view;
      }
    }
  }

  /** Avancer d'une etape (appele depuis TourOverlay). */
  function handleTourNext(): void {
    const next = currentTourStepIndex + 1;
    if (next >= tourSteps.length) {
      closeTour();
    } else {
      tourStep.set(next);
    }
  }

  /** Reculer d'une etape (appele depuis TourOverlay). */
  function handleTourPrev(): void {
    const prev = currentTourStepIndex - 1;
    if (prev >= 0) {
      tourStep.set(prev);
    }
  }

  /** Ferme la visite guidee. */
  function handleTourClose(): void {
    closeTour();
  }

  // ── Chat dock layout ───────────────────────────────────────────────────────
  // When the chat is docked + open, reserve space on the right so the demo
  // content is never hidden behind the panel.
  $: chatLayout = $chatWidgetLayout;
  $: dockPaddingCss =
    chatLayout.mode === "docked" && chatLayout.isOpen
      ? chatLayout.dockWidthCss
      : "0px";

  // ── Auto-start 1re visite ─────────────────────────────────────────────────
  onMount(() => {
    if (isFirstVisit()) {
      startTour();
    }
  });
</script>

<ThemeProvider theme={sentTechTheme}>
  <div
    class="flex h-screen overflow-hidden transition-[padding] duration-200"
    style={`padding-right: ${dockPaddingCss};`}
  >
    <AppSidebar
      {activeView}
      onSelect={(view) => (activeView = view)}
      onStartTour={startTour}
    />
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

  <!-- Assistant radar (chat reel @sentropic/chat-ui, ancre par defaut) -->
  <ChatWidgetHost />

  <!-- Visite guidee (overlay bulle jaune) -->
  <TourOverlay
    steps={tourSteps}
    active={isTourActive}
    currentIndex={currentTourStepIndex}
    onNext={handleTourNext}
    onPrev={handleTourPrev}
    onClose={handleTourClose}
  />
</ThemeProvider>
