<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { ThemeProvider } from "@sentropic/design-system-svelte";
  import { sentTechTheme } from "@sentropic/design-system-themes";
  import TopNav from "$lib/components/TopNav.svelte";
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
  import GeoView from "$lib/components/geo/GeoView.svelte";
  import ChatWidgetHost from "$lib/components/chat/ChatWidgetHost.svelte";
  import PendingView from "$lib/components/auth/PendingView.svelte";
  import RejectedView from "$lib/components/auth/RejectedView.svelte";
  import AdminView from "$lib/components/admin/AdminView.svelte";
  import { chatWidgetLayout } from "$lib/chat/chat-widget-layout";
  import { setChatContext } from "$lib/chat/chat-context";
  import type { SignalT } from "@radar/domain";
  import { authStore } from "$lib/auth/auth-store.js";
  import {
    activeGeoRoute,
    activeRouteView,
    navigateTo,
    initRouter,
  } from "$lib/router/router.js";

  // Vue par défaut : pilotée par le routeur (synchronisé avec l'URL hash)
  $: activeView = $activeRouteView;
  /** Signal id transmis par Approfondir -> filtre OpportunityFunnel. */
  let opportuniteSignalId: string | undefined = undefined;
  /** Label humain du signal sélectionné (signal-2 : libellé lisible dans le chip de filtre). */
  let opportuniteSignalLabel: string | undefined = undefined;

  // Auth state
  $: authState = $authStore;

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
    navigateTo("opportunity");
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

  async function handleLogout(): Promise<void> {
    await fetch("/api/v1/auth/logout");
    authStore.redirectToLogin();
  }

  // ── Chat dock layout ───────────────────────────────────────────────────────
  // When the chat is docked + open, reserve space on the right so the demo
  // content is never hidden behind the panel.
  $: chatLayout = $chatWidgetLayout;
  $: dockPaddingCss =
    chatLayout.mode === "docked" && chatLayout.isOpen
      ? chatLayout.dockWidthCss
      : "0px";

  // ── Redirection auth ──────────────────────────────────────────────────────
  // Guard SPA : dès que le statut devient "non authentifié et auth activée",
  // on navigue vers le endpoint login. On utilise une déclaration réactive
  // ($:) pour réagir aux changements du store, PAS un {@const} dans le markup
  // (anti-pattern : les effets de bord dans le template Svelte ne se
  // déclenchent pas de façon fiable).
  $: {
    if (!authState.loading && !authState.authenticated && !authState.authDisabled) {
      authStore.redirectToLogin();
    }
  }

  // Cleanup du listener popstate du routeur
  let cleanupRouter: (() => void) | undefined;

  onMount(async () => {
    cleanupRouter = initRouter();
    await authStore.checkSession();
  });

  onDestroy(() => {
    cleanupRouter?.();
  });
</script>

<ThemeProvider theme={sentTechTheme}>
  {#if authState.loading}
    <div class="flex h-screen items-center justify-center">
      <span class="text-slate-500 text-sm">Chargement...</span>
    </div>
  {:else if !authState.authenticated && !authState.authDisabled}
    <!-- Redirection en cours (déclenchée par le guard réactif dans le script) -->
    <div class="flex h-screen items-center justify-center">
      <span class="text-slate-500 text-sm">Redirection vers la connexion...</span>
    </div>
  {:else if authState.user?.status === "pending"}
    <PendingView />
  {:else if authState.user?.status === "rejected"}
    <RejectedView />
  {:else}
    <div
      class="flex h-screen flex-col overflow-hidden transition-[padding] duration-200"
      style={`padding-right: ${dockPaddingCss};`}
    >
      <!-- Barre de navigation horizontale -->
      <TopNav
        {activeView}
        onSelect={(view) => navigateTo(view)}
        {authState}
        onLogout={handleLogout}
      />

      <!-- Zone de contenu -->
      <!-- 4 vues principales -->
      {#if activeView === "signaux"}
        <!-- Vue Signaux : carte aplats GeoJSON coloriés par nb d'opportunités / 6 mois -->
        <SignauxMapView geoRoute={$activeGeoRoute} />
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
      {:else if activeView === "admin"}
        <AdminView />
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
      <!-- G3 — Vue Géo (zones + lots + opportunités) -->
      {:else if activeView === "geo"}
        <GeoView />
      <!-- Legacy deep-links (redirigés vers les vues principales équivalentes) -->
      {:else if activeView === "carte-signaux"}
        <SignauxMapView geoRoute={$activeGeoRoute} />
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
  {/if}
</ThemeProvider>
