<script lang="ts">
  import { Radar, BarChart3, Layers } from "@lucide/svelte";
  import type { DemoView } from "$lib/demo/views";

  export let activeView: DemoView;
  export let onSelect: (view: DemoView) => void;

  const items: { id: DemoView; label: string; icon: typeof Radar }[] = [
    { id: "radar", label: "Radar (démo)", icon: Radar },
    { id: "comparison", label: "Comparaison des agents", icon: BarChart3 },
    { id: "source-review", label: "Revue des sources", icon: Layers },
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
</nav>
