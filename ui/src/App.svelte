<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { ThemeProvider } from "@sentropic/design-system-svelte";
  import { sentTechTheme } from "@sentropic/design-system-themes";
  import TopNav from "$lib/components/TopNav.svelte";
  import type { DemoView } from "$lib/demo/views";
  import OnboardingView from "$lib/components/onboarding/OnboardingView.svelte";
  import CiblageView from "$lib/components/ciblage/CiblageView.svelte";
  import OpportunityFunnel from "$lib/components/opportunity/OpportunityFunnel.svelte";
  import ConsoleView from "$lib/components/console/ConsoleView.svelte";
  import BacklogView from "$lib/components/backlog/BacklogView.svelte";
  import KanbanView from "$lib/components/kanban/KanbanView.svelte";
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
  import LoginView from "$lib/components/auth/LoginView.svelte";
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
    // Déconnexion serveur : efface le cookie de session (GET /logout ->
    // deleteCookie). On envoie `Accept: application/json` pour récupérer la
    // réponse JSON `{ok:true}` plutôt qu'un 302 (navigation), et on ignore les
    // erreurs réseau (le reload ci-dessous re-sondera /me de toute façon).
    try {
      await fetch("/api/v1/auth/logout", {
        headers: { Accept: "application/json" },
      });
    } catch {
      /* réseau indisponible : on recharge quand même pour repartir propre. */
    }
    // Purge le disjoncteur anti-boucle (#260) : sinon, au prochain /me toujours
    // non authentifié, le marqueur ferait croire à une boucle et bloquerait la
    // reconnexion (LoginView "blocked"). Le logout est un état propre, pas une
    // tentative échouée.
    authStore.resetLoginAttempt();
    // Logout EXPLICITE = flux sensible : on force la ré-auth (`prompt=login`) au
    // prochain « Se connecter », pour que l'IdP ré-affiche le login plutôt que de
    // réémettre silencieusement un token pour la session SSO en place (symptôme
    // « reconnect = compte précédent »). Le re-login ordinaire (session expirée),
    // lui, reste silencieux. Le marqueur survit au reload du même onglet.
    authStore.markForceReauth();
    // Rechargement COMPLET vers la racine : la SPA se réinitialise, rappelle
    // /api/v1/auth/me (désormais non authentifié) et affiche LoginView. Sans ce
    // reload, le store auth resterait "authentifié" en mémoire et rien ne
    // changerait à l'écran malgré le cookie supprimé côté serveur.
    window.location.assign("/");
  }

  // ── Chat dock layout ───────────────────────────────────────────────────────
  // When the chat is docked + open, reserve space on the right so the demo
  // content is never hidden behind the panel.
  $: chatLayout = $chatWidgetLayout;
  $: dockPaddingCss =
    chatLayout.mode === "docked" && chatLayout.isOpen
      ? chatLayout.dockWidthCss
      : "0px";

  // ── Guard auth ────────────────────────────────────────────────────────────
  // Quand l'utilisateur n'est pas authentifié et que l'auth est activée, on
  // affiche une page de connexion STATIQUE (LoginView) — PAS de redirection
  // automatique. Une auto-redirection ici provoquait un ping-pong infini sur
  // mobile : si le cookie de session n'était pas reçu au retour de l'IdP,
  // /me répondait toujours `authenticated:false`, ce qui relançait /login,
  // que l'IdP ré-autorisait silencieusement, etc. C'est désormais un clic
  // explicite de l'utilisateur qui lance le flux OIDC (voir auth-store.ts pour
  // le disjoncteur `loginBlocked`).
  function handleLogin(): void {
    authStore.resetLoginAttempt();
    authStore.redirectToLogin();
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
    <!-- Page de connexion statique : aucun auto-redirect (anti-boucle mobile).
         `blocked` distingue le cas "première connexion" du cas "cookie bloqué
         après une tentative" (disjoncteur loginBlocked). -->
    <LoginView blocked={authState.loginBlocked} onLogin={handleLogin} />
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
        <!-- Legacy deep-link #/grilles : la vue Grilles est désormais intégrée
             comme onglet de la vue Évaluation (WP4). On route donc vers
             EvaluationMapView avec l'onglet « Grilles de score » pré-sélectionné. -->
        <EvaluationMapView initialTab="grilles" />
      {:else if activeView === "ontologie"}
        <ReconciliationView />
      {:else if activeView === "coordination"}
        <CoordinationView />
      {:else if activeView === "backlog"}
        <BacklogView />
      {:else if activeView === "kanban"}
        <!-- WP6 — Kanban WorkPackages (projection 4 niveaux) -->
        <KanbanView />
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
