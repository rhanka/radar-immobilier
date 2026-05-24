<script lang="ts">
  import { FileText, LandPlot, MapPinned, Scale } from "@lucide/svelte";
  import type { RadarSignal } from "$lib/demo/radar-demo-data";

  export let signals: RadarSignal[];
  export let selectedSignalId: string;
  export let onSelectSignal: (signalId: string) => void;

  const iconByKind = {
    ppcmoi: FileText,
    zoning: LandPlot,
    cptaq: MapPinned,
    derogation: Scale,
  };
</script>

<aside class="flex min-h-0 flex-col rounded-md border border-slate-200 bg-white">
  <div class="border-b border-slate-200 px-4 py-3">
    <h2 class="text-sm font-semibold text-slate-950">File de signaux</h2>
    <p class="mt-1 text-xs text-slate-500">Priorisee par score, timing et confiance</p>
  </div>

  <div class="min-h-0 flex-1 overflow-auto p-2">
    <div class="space-y-2">
      {#each signals as signal}
        {@const Icon = iconByKind[signal.kind]}
        <button
          class={`w-full rounded-md border p-3 text-left transition ${
            selectedSignalId === signal.id
              ? "border-teal-500 bg-teal-50"
              : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
          }`}
          type="button"
          on:click={() => onSelectSignal(signal.id)}
        >
          <div class="flex gap-3">
            <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-700">
              <Icon class="h-4 w-4" aria-hidden="true" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-start justify-between gap-2">
                <h3 class="min-w-0 text-sm font-semibold leading-5 text-slate-950">
                  {signal.title}
                </h3>
                <span class="rounded-md bg-slate-900 px-2 py-1 text-xs font-semibold text-white">
                  {signal.score}
                </span>
              </div>
              <p class="mt-1 text-xs text-slate-500">{signal.sourceLabel}</p>
              <p class="mt-2 line-clamp-2 text-xs leading-5 text-slate-600">
                {signal.summary}
              </p>
            </div>
          </div>
        </button>
      {/each}
    </div>
  </div>
</aside>
