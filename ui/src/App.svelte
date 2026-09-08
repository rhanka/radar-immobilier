<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { ThemeProvider } from "@sentropic/design-system-svelte";
  import { sentTechTheme } from "@sentropic/design-system-themes";
  import TopNav from "$lib/components/TopNav.svelte";
  import type { DemoView } from "$lib/demo/views";
  import OnboardingView from "$lib/components/onboarding/OnboardingView.svelte";
  import CiblageView from "$lib/components/ciblage/CiblageView.svelte";
  import OpportunityFunnel from "$lib/components/opportunity/OpportunityFunnel.svelte";
  import BacklogView from "$lib/components/backlog/BacklogView.svelte";
  import KanbanView from "$lib/components/kanban/KanbanView.svelte";
  import CoordinationView from "$lib/components/coordination/CoordinationView.svelte";
  import SourceMapView from "$lib/components/sources-map/SourceMapView.svelte";
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
  import RapportView from "$lib/components/rapport/RapportView.svelte";
  import PalierMatrix from "$lib/palier/PalierMatrix.svelte";
  import { chatWidgetLayout } from "$lib/chat/chat-widget-layout";
  import { acquireChatTrigger } from "$lib/chat/chat-trigger";
  import { setChatContext } from "$lib/chat/chat-context";
  import type { SignalT } from "@radar/domain";
  import { authStore } from "$lib/auth/auth-store.js";
  import {
    activeGeoRoute,
    activeRouteView,
    navigateTo,
    initRouter,
  } from "$lib/router/router.js";
  import { initEvaluationBetaShortcut } from "$lib/state/beta.js";

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
  // §5 R3 P2 — en MOBILE (≤639px), chat-ui FORCE le mode docked et publie
  // `dockWidthCss:"100vw"` : le dock rend un overlay PLEIN-ÉCRAN. Réserver 100vw
  // ÉCRASE tout le contenu (padding-right:100vw ⇒ largeur de contenu 0) et pousse le
  // cluster de contrôles carte HORS-ÉCRAN (mesuré x≈-30px). On NE réserve donc
  // l'espace QUE lorsque le dock a une largeur PARTIELLE (desktop : 33vw/50vw) ; en
  // plein-écran, la coexistence du cluster passe par son z-index (GeoCityMapBase,
  // au-dessus de l'overlay z-50), pas par une réservation de largeur. Desktop (#579)
  // inchangé : `dockWidthCss` y vaut 33vw/50vw ≠ 100vw → réservation identique.
  $: dockPaddingCss =
    chatLayout.mode === "docked" &&
    chatLayout.isOpen &&
    chatLayout.dockWidthCss !== "100vw"
      ? chatLayout.dockWidthCss
      : "0px";

  // ── §5 R2 point 2 — bulle de chat masquée sur la vue Signaux ────────────────
  // Sur les routes Signaux, le déclencheur du chat est le bouton CARRÉ de la
  // rangée de contrôles carte (SignauxMapView → slot socle) : on SUPPRIME donc la
  // bulle ronde flottante globale pour ne pas avoir DEUX déclencheurs. Mécanisme
  // UNIQUE : le store #564 (`acquireChatTrigger`, ref-compté → robuste aux
  // transitions de route). Les AUTRES vues gardent la bulle actuelle inchangée.
  let releaseChatBubble: (() => void) | undefined;
  function syncChatBubbleSuppression(onSignaux: boolean): void {
    if (onSignaux && !releaseChatBubble) {
      releaseChatBubble = acquireChatTrigger();
    } else if (!onSignaux && releaseChatBubble) {
      releaseChatBubble();
      releaseChatBubble = undefined;
    }
  }
  // Dépend UNIQUEMENT de `activeView` (les seules vues qui montent SignauxMapView
  // sont « signaux » et le deep-link legacy « carte-signaux » — cf. App template).
  $: syncChatBubbleSuppression(
    activeView === "signaux" || activeView === "carte-signaux",
  );

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
  // Cleanup du raccourci beta global (Ctrl+Shift+X — révèle Évaluation)
  let cleanupBetaShortcut: (() => void) | undefined;

  onMount(async () => {
    cleanupRouter = initRouter();
    // Raccourci beta GLOBAL (monté une fois, comme le routeur) : Ctrl+Shift+X
    // bascule le flag `radar.beta.evaluation` (persisté) qui révèle/masque
    // l'entrée « Évaluation » dans TopNav. Effets de navigation :
    //   - à l'activation, on route directement vers la vue Évaluation
    //     (feedback immédiat de la feature révélée) ;
    //   - à la désactivation, si on est SUR Évaluation, on revient à Signaux
    //     (pour ne pas rester sur une vue désormais masquée de la nav — la
    //     route #/evaluation reste néanmoins valide en accès direct).
    cleanupBetaShortcut = initEvaluationBetaShortcut((enabled) => {
      if (enabled) {
        navigateTo("evaluation");
      } else if (activeView === "evaluation") {
        navigateTo("signaux");
      }
    });
    await authStore.checkSession();
  });

  onDestroy(() => {
    cleanupRouter?.();
    cleanupBetaShortcut?.();
    // §5 R2 — libère la suppression de bulle #564 si App est détruit sur Signaux.
    releaseChatBubble?.();
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
    <!-- §5 R5 mobile — ancrage viewport du shell au PETIT viewport (`app-shell`,
         cf. <style>). `h-screen` (=100vh) valait la hauteur GRAND viewport (barre
         d'URL masquée) : en mobile barre AFFICHÉE la bande de contrôle bas
         (clusters + attribution, ancrés `bottom-20` du bord bas de la carte)
         tombait SUR la ligne de flottaison (mesuré : bas bande à 764 = fold 764,
         clearance 0). `100svh` (petit viewport = barre visible) est STABLE — il
         ne se recalcule pas quand la barre se masque, donc la bande ne bouge pas
         (mesuré : clearance 80 constant, drift 0 vs 80 px sous `dvh`). -->
    <div
      class="app-shell flex flex-col overflow-hidden transition-[padding] duration-200"
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
        <SourceMapView />
      {:else if activeView === "console"}
        <!-- Deep-link legacy #/console : la Console est désormais l'onglet
             « Console » de la vue Source (reconstruite sur /api/source/coverage).
             On monte donc SourceMapView avec cet onglet pré-sélectionné. -->
        <SourceMapView initialTab="console" />
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
      {:else if activeView === "rapport"}
        <!-- Rapport d'étude — route discrète #/rapport (contenu
             docs/spec/reports/study-2026-07 compilé au build, rendu tokens DS). -->
        <RapportView />
      {:else if activeView === "ontologie"}
        <ReconciliationView />
      {:else if activeView === "coordination"}
        <CoordinationView />
      {:else if activeView === "backlog"}
        <BacklogView />
      {:else if activeView === "kanban"}
        <!-- WP6 — Kanban WorkPackages (projection 4 niveaux) -->
        <KanbanView />
      {:else if activeView === "matrice"}
        <!-- #1/#1b — Matrice de suivi villes × KPI (palier-matrix/v1). Route
             discrète #/matrice (hors nav principale strict-3). Scaffold :
             placeholder « proxy immo geo-lot pending » jusqu'au hand geo. -->
        <PalierMatrix />
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
        <!-- Fallback : vue par défaut (DEFAULT_VIEW = signaux). L'ancienne
             Console n'existe plus ; la route #/console atterrit explicitement
             sur la vue Source onglet Console (cf. branche ci-dessus). -->
        <SignauxMapView geoRoute={$activeGeoRoute} />
      {/if}
    </div>

    <!-- Assistant radar (chat reel @sentropic/chat-ui, ancre par defaut) -->
    <ChatWidgetHost />
  {/if}
</ThemeProvider>

<style>
  /* §5 R5 mobile — hauteur du shell principal.
     Cascade fallback : `100vh` d'abord (navigateurs sans unités viewport
     dynamiques), puis `100svh` (small viewport height) qui l'emporte quand il
     est supporté. `svh` = hauteur AVEC la barre d'URL mobile visible : c'est la
     plus PETITE hauteur, donc la bande de contrôle bas reste toujours visible,
     et surtout STABLE — `svh` ne se recalcule pas quand la barre se masque
     (contrairement à `dvh`, qui ferait glisser la bande de 80 px pendant le
     scroll). Sur DESKTOP il n'y a pas de barre d'URL rétractable → svh = vh =
     lvh = plein écran, donc aucun changement desktop. */
  .app-shell {
    height: 100vh;
    height: 100svh;
  }
</style>
