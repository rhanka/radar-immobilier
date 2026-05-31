<script lang="ts">
  import {
    Rocket,
    Radio,
    Building2,
    SlidersHorizontal,
    MonitorDot,
    Zap,
  } from "@lucide/svelte";
  import type { DemoView } from "$lib/demo/views";
  import { appMode, toggleMode } from "$lib/state/mode.js";

  export let activeView: DemoView;
  export let onSelect: (view: DemoView) => void;

  $: mode = $appMode;

  const items: { id: DemoView; label: string; icon: typeof Rocket }[] = [
    { id: "onboarding", label: "Onboarding", icon: Rocket },
    { id: "signaux", label: "Signaux", icon: Radio },
    { id: "opportunity", label: "Opportunités", icon: Building2 },
    { id: "console", label: "Sources", icon: MonitorDot },
    { id: "automation", label: "Automatisation", icon: Zap },
    { id: "grilles", label: "Grilles", icon: SlidersHorizontal },
  ];
</script>

<aside class="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
  <!-- Logo / titre -->
  <div class="border-b border-slate-200 px-4 py-4">
    <span class="text-sm font-bold tracking-tight text-slate-950">Radar immobilier</span>
  </div>

  <!-- Nav items -->
  <nav class="flex-1 overflow-y-auto px-2 py-3">
    {#each items as item}
      {@const Icon = item.icon}
      <button
        type="button"
        aria-current={activeView === item.id ? "page" : undefined}
        class={`mb-0.5 flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
          activeView === item.id
            ? "bg-teal-600 text-white"
            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
        }`}
        on:click={() => onSelect(item.id)}
      >
        <Icon class="h-4 w-4 shrink-0" aria-hidden="true" />
        {item.label}
      </button>
    {/each}
  </nav>

  <!-- Réel/Simulation toggle -->
  <div class="border-t border-slate-200 px-4 py-3">
    <button
      type="button"
      aria-label={mode === "real" ? "Passer en mode simulation" : "Passer en mode réel"}
      title={mode === "real" ? "Passer en mode simulation" : "Passer en mode réel"}
      on:click={toggleMode}
      class={`inline-flex w-full items-center justify-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-offset-1 ${
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
</aside>
