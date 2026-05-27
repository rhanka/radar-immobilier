<script lang="ts">
  import { Rocket, Radar, Radio, BarChart3, Layers, Building2, SlidersHorizontal, MessagesSquare } from "@lucide/svelte";
  import type { DemoView } from "$lib/demo/views";
  import { appMode, toggleMode } from "$lib/state/mode.js";

  export let activeView: DemoView;
  export let onSelect: (view: DemoView) => void;

  $: mode = $appMode;

  const items: { id: DemoView; label: string; icon: typeof Radar }[] = [
    { id: "onboarding", label: "Onboarding (T0)", icon: Rocket },
    { id: "radar", label: "Radar (démo)", icon: Radar },
    { id: "signaux", label: "Signaux (T1)", icon: Radio },
    { id: "comparison", label: "Comparaison des agents", icon: BarChart3 },
    { id: "source-review", label: "Revue des sources", icon: Layers },
    { id: "opportunity", label: "Opportunité", icon: Building2 },
    { id: "grilles", label: "Grilles de score", icon: SlidersHorizontal },
    { id: "coordination", label: "Coordination", icon: MessagesSquare },
  ];
</script>

<nav class="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-4 py-2">
  <span class="mr-2 text-sm font-bold tracking-tight text-slate-950">Radar immobilier</span>
  <div class="flex flex-wrap gap-1">
    {#each items as item}
      {@const Icon = item.icon}
      <button
        type="button"
        aria-current={activeView === item.id ? "page" : undefined}
        class={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${
          activeView === item.id
            ? "bg-teal-600 text-white"
            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
        }`}
        on:click={() => onSelect(item.id)}
      >
        <Icon class="h-4 w-4" aria-hidden="true" />
        {item.label}
      </button>
    {/each}
  </div>

  <!-- Réel/Simulation pill toggle — global mode (visible sur toutes les vues) -->
  <div class="ml-auto flex shrink-0 items-center">
    <button
      type="button"
      aria-label={mode === "real" ? "Passer en mode simulation" : "Passer en mode réel"}
      title={mode === "real" ? "Passer en mode simulation" : "Passer en mode réel"}
      on:click={toggleMode}
      class={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-offset-1 ${
        mode === "real"
          ? "border-teal-300 bg-teal-50 text-teal-800 hover:bg-teal-100 focus:ring-teal-400"
          : "border-violet-300 bg-violet-50 text-violet-800 hover:bg-violet-100 focus:ring-violet-400"
      }`}
    >
      <span
        class={`h-2 w-2 rounded-full ${mode === "real" ? "bg-teal-500" : "bg-violet-500"}`}
      ></span>
      {mode === "real" ? "Réel" : "Simulation"}
    </button>
  </div>
</nav>
