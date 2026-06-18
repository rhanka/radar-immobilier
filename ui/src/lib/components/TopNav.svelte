<script lang="ts">
  import {
    Rocket,
    Radio,
    Building2,
    SlidersHorizontal,
    MonitorDot,
    KanbanSquare,
    Network,
    GitMerge,
    MapPin,
    Target,
    BarChart3,
    ShieldCheck,
    LogOut,
    ChevronDown,
    Settings,
    Map,
  } from "@lucide/svelte";
  import { Badge, Button, Header } from "@sentropic/design-system-svelte";
  import type { DemoView } from "$lib/demo/views.js";
  import type { AuthState } from "$lib/auth/auth-store.js";
  import { appMode, toggleMode } from "$lib/state/mode.js";

  export let activeView: DemoView;
  export let onSelect: (view: DemoView) => void;
  /** Callback pour lancer / relancer la visite guidee. */
  export let onStartTour: (() => void) | undefined = undefined;
  /** Etat d'authentification (optionnel pour compatibilite). */
  export let authState: AuthState | undefined = undefined;
  /** Callback de deconnexion. */
  export let onLogout: (() => void) | undefined = undefined;

  $: mode = $appMode;
  $: isAdmin = authState?.user?.isAdmin === true;

  /** 4 vues principales — navigation visible. */
  const mainItems: { id: DemoView; label: string; icon: typeof Rocket }[] = [
    { id: "signaux", label: "Signaux", icon: Radio },
    { id: "opportunity", label: "Opportunités", icon: Building2 },
    { id: "evaluation", label: "Évaluation", icon: BarChart3 },
    { id: "sources", label: "Sources", icon: MapPin },
  ];

  /** Vues admin/dev — cachées derrière le menu déroulant. */
  const adminItems: { id: DemoView; label: string; icon: typeof Rocket }[] = [
    { id: "admin", label: "Admin", icon: ShieldCheck },
    { id: "onboarding", label: "Onboarding", icon: Rocket },
    { id: "ciblage", label: "Ciblage", icon: Target },
    { id: "grilles", label: "Grilles", icon: SlidersHorizontal },
    { id: "console", label: "Console sources", icon: MonitorDot },
    { id: "ontologie", label: "Ontologie", icon: GitMerge },
    { id: "coordination", label: "Coordination", icon: Network },
    { id: "backlog", label: "Backlog", icon: KanbanSquare },
    // G3 — Vue Géo (zones + lots + opportunités)
    { id: "geo", label: "Carte géo", icon: Map },
  ];

  let adminMenuOpen = false;

  /** Vérifier si la vue active est une vue admin/dev. */
  $: isAdminActive = adminItems.some((item) => item.id === activeView);

  function selectAndClose(view: DemoView): void {
    onSelect(view);
    adminMenuOpen = false;
  }
</script>

<Header title="Radar immobilier" sticky={false} label="Navigation principale">
  {#snippet navigation()}
    <!-- Nav principale : 4 vues -->
    <div class="flex items-center gap-1">
      {#each mainItems as item}
        {@const Icon = item.icon}
        <Button
          type="button"
          size="sm"
          variant={activeView === item.id ? "primary" : "ghost"}
          aria-current={activeView === item.id ? "page" : undefined}
          class="whitespace-nowrap"
          onclick={() => onSelect(item.id)}
        >
          <Icon class="h-4 w-4 shrink-0" aria-hidden="true" />
          {item.label}
        </Button>
      {/each}

      <!-- Menu admin/dev -->
      <div class="relative">
        <Button
          type="button"
          size="sm"
          variant={isAdminActive ? "primary" : "ghost"}
          aria-haspopup="true"
          aria-expanded={adminMenuOpen}
          class="whitespace-nowrap"
          onclick={() => (adminMenuOpen = !adminMenuOpen)}
        >
          <Settings class="h-4 w-4 shrink-0" aria-hidden="true" />
          Outils
          <ChevronDown class={`h-3.5 w-3.5 shrink-0 transition-transform ${adminMenuOpen ? "rotate-180" : ""}`} aria-hidden="true" />
        </Button>

        {#if adminMenuOpen}
          <!-- Backdrop pour fermer le menu -->
          <!-- svelte-ignore a11y-click-events-have-key-events -->
          <!-- svelte-ignore a11y-no-static-element-interactions -->
          <div
            class="fixed inset-0 z-10"
            on:click={() => (adminMenuOpen = false)}
          ></div>

          <!-- Dropdown menu -->
          <div class="absolute left-0 top-full z-20 mt-1 min-w-48 rounded-lg border border-slate-200 bg-white shadow-lg py-1">
            <p class="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Outils internes
            </p>
            {#each adminItems as item}
              {#if item.id !== "admin" || isAdmin}
                {@const Icon = item.icon}
                <Button
                  type="button"
                  size="sm"
                  variant={activeView === item.id ? "primary" : "ghost"}
                  aria-current={activeView === item.id ? "page" : undefined}
                  class="w-full justify-start"
                  onclick={() => selectAndClose(item.id)}
                >
                  <Icon class="h-4 w-4 shrink-0" aria-hidden="true" />
                  {item.label}
                </Button>
              {/if}
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {/snippet}

  {#snippet actions()}
    <!-- Actions : visite guidee + toggle Réel/Carte Steve + user info + logout -->
    <div class="flex items-center gap-2">
      {#if onStartTour}
        <Button
          type="button"
          size="sm"
          variant="secondary"
          aria-label="Lancer la visite guidée"
          title="Lancer la visite guidée"
          onclick={onStartTour}
        >
          <MapPin class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Visite guidée
        </Button>
      {/if}

      <Button
        type="button"
        size="sm"
        variant="secondary"
        aria-label={mode === "real" ? "Afficher les données carte Steve" : "Afficher les données réelles collectées"}
        title={mode === "real" ? "Afficher les données carte Steve" : "Afficher les données réelles collectées"}
        onclick={toggleMode}
      >
        <Badge tone={mode === "real" ? "success" : "info"}>
          {mode === "real" ? "Réel" : "Carte Steve"}
        </Badge>
      </Button>

      {#if authState?.authenticated && authState.user}
        <!-- User name chip -->
        <span class="max-w-[120px] truncate text-xs text-slate-500" title={authState.user.email ?? authState.user.sub}>
          {authState.user.name ?? authState.user.email ?? authState.user.sub}
        </span>
        <!-- Logout button -->
        {#if onLogout}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            aria-label="Se déconnecter"
            title="Se déconnecter"
            onclick={onLogout}
          >
            <LogOut class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Déconnexion
          </Button>
        {/if}
      {/if}
    </div>
  {/snippet}
</Header>
