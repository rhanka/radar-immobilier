<script lang="ts">
  import { onMount } from "svelte";
  import { ThemeProvider } from "@sentropic/design-system-svelte";
  import { sentTechTheme } from "@sentropic/design-system-themes";
  import TopNav from "$lib/components/TopNav.svelte";
  import ViewLayout from "$lib/components/ViewLayout.svelte";
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
  /** Label humain du signal sélectionné (signal-2 : libellé lisible dans le chip de filtre). */
  let opportuniteSignalLabel: string | undefined = undefined;

  // Libellés lisibles par type de signal
  const TYPE_LABELS_SHORT: Record<string, string> = {
    "residential-rezoning": "Rezonage résidentiel",
    "cptaq": "CPTAQ",
    "ppcmoi": "PPCMOI",
    "public-consultation": "Consultation publique",
    "plan-urbanisme": "Plan d'urbanisme",
    "grid-cos-modification": "Modification grille/COS",
    "derogation-relevant": "Dérogation pertinente",
    "derogation-irrelevant": "Dérogation non pertinente",
  };

  function buildSignalLabel(signal: SignalT): string {
    const type = TYPE_LABELS_SHORT[signal.type] ?? signal.type;
    const parts: string[] = [type];
    if (signal.bylaw) parts.push(`Règl. ${signal.bylaw}`);
    if (signal.zone) parts.push(signal.zone);
    return parts.join(" · ");
  }

  function handleApprofondir(signal: SignalT): void {
    opportuniteSignalId = signal.id;
    opportuniteSignalLabel = buildSignalLabel(signal);
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
    class="flex h-screen flex-col overflow-hidden transition-[padding] duration-200"
    style={`padding-right: ${dockPaddingCss};`}
  >
    <!-- Barre de navigation horizontale -->
    <TopNav
      {activeView}
      onSelect={(view) => (activeView = view)}
      onStartTour={startTour}
    />

    <!-- Zone de contenu : OpportunityFunnel garde son propre layout full-width -->
    {#if activeView === "opportunity"}
      <ViewLayout fullWidth={true}>
        <OpportunityFunnel
          selectedSignalId={opportuniteSignalId}
          selectedSignalLabel={opportuniteSignalLabel}
          onClearFilter={() => { opportuniteSignalId = undefined; opportuniteSignalLabel = undefined; }}
        />
      </ViewLayout>
    {:else if activeView === "onboarding"}
      <ViewLayout>
        <OnboardingView />
      </ViewLayout>
    {:else if activeView === "signaux"}
      <SignalsT1View onApprofondir={handleApprofondir} />
    {:else if activeView === "grilles"}
      <GrillesView />
    {:else if activeView === "console"}
      <ViewLayout>
        <ConsoleView />
      </ViewLayout>
    {:else}
      <ViewLayout>
        <AutomationView />
      </ViewLayout>
    {/if}
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
