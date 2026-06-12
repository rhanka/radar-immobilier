<script lang="ts">
  import { onMount } from "svelte";
  import { ThemeProvider } from "@sentropic/design-system-svelte";
  import { sentTechTheme } from "@sentropic/design-system-themes";
  import TopNav from "$lib/components/TopNav.svelte";
  import TourOverlay from "$lib/components/tour/TourOverlay.svelte";
  import type { DemoView } from "$lib/demo/views";
  import OnboardingView from "$lib/components/onboarding/OnboardingView.svelte";
  import CiblageView from "$lib/components/ciblage/CiblageView.svelte";
  import OpportunityFunnel from "$lib/components/opportunity/OpportunityFunnel.svelte";
  import GrillesView from "$lib/components/scoring/GrillesView.svelte";
  import ConsoleView from "$lib/components/console/ConsoleView.svelte";
  import BacklogView from "$lib/components/backlog/BacklogView.svelte";
  import CoordinationView from "$lib/components/coordination/CoordinationView.svelte";
  import SourcesMapView from "$lib/components/sources-map/SourcesMapView.svelte";
  import ReconciliationView from "$lib/components/reconciliation/ReconciliationView.svelte";
  import SignalsT1View from "$lib/components/signals/SignalsT1View.svelte";
  import SignauxMapView from "$lib/components/maps/SignauxMapView.svelte";
  import OpportunitesMapView from "$lib/components/maps/OpportunitesMapView.svelte";
  import EvaluationMapView from "$lib/components/maps/EvaluationMapView.svelte";
  import ChatWidgetHost from "$lib/components/chat/ChatWidgetHost.svelte";
  import { chatWidgetLayout } from "$lib/chat/chat-widget-layout";
  import { setChatContext } from "$lib/chat/chat-context";
  import type { SignalT } from "@radar/domain";
  import { tourActive, tourStep, startTour, closeTour, isFirstVisit } from "$lib/state/tour.js";
  import { tourSteps } from "$lib/tour/tour-steps.js";

  // Vue par défaut : Signaux (1ère vue principale)
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
    // P3 — expose the selected signal as an already-resolved chat context chip.
    setChatContext([
      {
        type: "signal",
        id: signal.id,
        label: opportuniteSignalLabel,
        active: true,
      },
    ]);
  }

  /** Efface le filtre d'opportunite et le chip de contexte du chat (P3). */
  function clearOpportuniteFilter(): void {
    opportuniteSignalId = undefined;
    opportuniteSignalLabel = undefined;
    setChatContext([]);
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

    <!-- Zone de contenu -->
    <!-- 4 vues principales -->
    {#if activeView === "signaux"}
      <!-- Vue Signaux : carte aplats GeoJSON coloriés par nb d'opportunités / 6 mois -->
      <SignauxMapView />
    {:else if activeView === "opportunity"}
      <OpportunityFunnel
        selectedSignalId={opportuniteSignalId}
        selectedSignalLabel={opportuniteSignalLabel}
        onClearFilter={clearOpportuniteFilter}
      />
    {:else if activeView === "evaluation"}
      <!-- Vue Évaluation : fusion EvaluationMapView + GrillesView (carte cadastrale + grilles) -->
      <EvaluationMapView />
    {:else if activeView === "sources"}
      <SourcesMapView />
    <!-- Vues admin/dev (hors nav principale) -->
    {:else if activeView === "onboarding"}
      <OnboardingView />
    {:else if activeView === "ciblage"}
      <CiblageView />
    {:else if activeView === "grilles"}
      <GrillesView />
    {:else if activeView === "ontologie"}
      <ReconciliationView />
    {:else if activeView === "coordination"}
      <CoordinationView />
    {:else if activeView === "backlog"}
      <BacklogView />
    <!-- Legacy deep-links (redirigés vers les vues principales équivalentes) -->
    {:else if activeView === "carte-signaux"}
      <SignauxMapView />
    {:else if activeView === "carte-opportunites"}
      <OpportunitesMapView />
    {:else if activeView === "carte-evaluation"}
      <EvaluationMapView />
    {:else}
      <!-- Fallback : console sources -->
      <ConsoleView />
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
