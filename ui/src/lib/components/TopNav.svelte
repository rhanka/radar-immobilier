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
    Map,
    Layers,
    BarChart3,
    ShieldCheck,
    LogOut,
  } from "@lucide/svelte";
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

  const baseItems: { id: DemoView; label: string; icon: typeof Rocket }[] = [
    { id: "onboarding", label: "Onboarding", icon: Rocket },
    { id: "ciblage", label: "Ciblage", icon: Target },
    { id: "signaux", label: "Signaux", icon: Radio },
    { id: "opportunity", label: "Opportunités", icon: Building2 },
    { id: "console", label: "Sources", icon: MonitorDot },
    { id: "ontologie", label: "Ontologie", icon: GitMerge },
    { id: "grilles", label: "Grilles", icon: SlidersHorizontal },
    { id: "coordination", label: "Coordination", icon: Network },
    { id: "backlog", label: "Backlog", icon: KanbanSquare },
    { id: "sources", label: "Recueil", icon: MapPin },
    { id: "carte-signaux", label: "Carte Signaux", icon: Map },
    { id: "carte-opportunites", label: "Carte Opport.", icon: Layers },
    { id: "carte-evaluation", label: "Carte Éval.", icon: BarChart3 },
  ];

  $: items = isAdmin
    ? [...baseItems, { id: "admin" as DemoView, label: "Admin", icon: ShieldCheck }]
    : baseItems;
</script>

<header class="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-4 py-2">
  <!-- Logo / titre -->
  <div class="mr-4 flex items-center gap-2 shrink-0">
    <span class="text-sm font-bold tracking-tight text-slate-950">Radar immobilier</span>
  </div>

  <!-- Nav items -->
  <nav class="flex flex-1 items-center gap-1" aria-label="Navigation principale">
    {#each items as item}
      {@const Icon = item.icon}
      <button
        type="button"
        aria-current={activeView === item.id ? "page" : undefined}
        class={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors whitespace-nowrap ${
          activeView === item.id
            ? item.id === "admin"
              ? "bg-violet-600 text-white"
              : "bg-teal-600 text-white"
            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
        }`}
        on:click={() => onSelect(item.id)}
      >
        <Icon class="h-4 w-4 shrink-0" aria-hidden="true" />
        {item.label}
      </button>
    {/each}
  </nav>

  <!-- Actions : visite guidee + toggle Réel/Carte Steve + user info + logout -->
  <div class="flex shrink-0 items-center gap-2">
    {#if onStartTour}
      <button
        type="button"
        aria-label="Lancer la visite guidée"
        title="Lancer la visite guidée"
        on:click={onStartTour}
        class="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 transition hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-1"
      >
        <MapPin class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Visite guidée
      </button>
    {/if}

    <button
      type="button"
      aria-label={mode === "real" ? "Afficher les données carte Steve" : "Afficher les données réelles scrappées"}
      title={mode === "real" ? "Afficher les données carte Steve" : "Afficher les données réelles scrappées"}
      on:click={toggleMode}
      class={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-offset-1 ${
        mode === "real"
          ? "border-teal-300 bg-teal-50 text-teal-800 hover:bg-teal-100 focus:ring-teal-400"
          : "border-violet-300 bg-violet-50 text-violet-800 hover:bg-violet-100 focus:ring-violet-400"
      }`}
    >
      <span
        class={`h-2 w-2 rounded-full ${mode === "real" ? "bg-teal-500" : "bg-violet-500"}`}
      ></span>
      {mode === "real" ? "Réel" : "Carte Steve"}
    </button>

    {#if authState?.authenticated && authState.user}
      <!-- User name chip -->
      <span class="max-w-[120px] truncate text-xs text-slate-500" title={authState.user.email ?? authState.user.sub}>
        {authState.user.name ?? authState.user.email ?? authState.user.sub}
      </span>
      <!-- Logout button -->
      {#if onLogout}
        <button
          type="button"
          aria-label="Se déconnecter"
          title="Se déconnecter"
          on:click={onLogout}
          class="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-1"
        >
          <LogOut class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Déconnexion
        </button>
      {/if}
    {/if}
  </div>
</header>
