<script lang="ts">
  import { ExternalLink } from "@lucide/svelte";
  import type { PhaseGroup } from "$lib/opportunites/funnel.js";

  export let group: PhaseGroup;

  function verificationClass(v: string): string {
    if (v === "fait") return "bg-emerald-100 text-emerald-700";
    if (v === "hypothese") return "bg-amber-100 text-amber-700";
    if (v === "simulé") return "bg-violet-100 text-violet-700";
    return "bg-slate-100 text-slate-500";
  }

  function verificationLabel(v: string): string {
    if (v === "fait") return "Fait";
    if (v === "hypothese") return "Hypothèse";
    if (v === "simulé") return "Simulé";
    return "N/D";
  }

  function confidenceClass(c: string): string {
    if (c === "high") return "bg-emerald-100 text-emerald-700";
    if (c === "medium") return "bg-amber-100 text-amber-700";
    return "bg-slate-100 text-slate-500";
  }

  function confidenceLabel(c: string): string {
    if (c === "high") return "haute";
    if (c === "medium") return "moyenne";
    return "faible";
  }
</script>

<div class="rounded-lg border border-slate-200 bg-white shadow-sm">
  <!-- Phase header -->
  <div class="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
    <span class="h-2 w-2 shrink-0 rounded-full bg-teal-500"></span>
    <h1 class="text-sm font-semibold uppercase tracking-wide text-slate-700">
      {group.label}
    </h1>
    <span class="ml-auto rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600">
      {group.items.length} indice{group.items.length > 1 ? "s" : ""}
    </span>
  </div>

  <!-- Evidence items -->
  <div class="divide-y divide-slate-100">
    {#each group.items as item}
      <div class="px-4 py-3">
        <div class="flex flex-wrap items-start gap-2">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-1.5">
              <p class="text-sm font-medium text-slate-900">{item.label}</p>
              {#if item.url}
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex shrink-0 items-center gap-0.5 text-xs text-teal-600 hover:text-teal-800"
                >
                  <ExternalLink class="h-3 w-3" aria-hidden="true" />
                  Source
                </a>
              {/if}
            </div>
            {#if item.value}
              <p class="mt-1 text-xs leading-5 text-slate-600">{item.value}</p>
            {/if}
            <p class="mt-1 text-[10px] text-slate-400">
              {item.date} · {item.obtentionMode}
            </p>
          </div>
          <div class="flex shrink-0 flex-col items-end gap-1">
            <span
              class={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${verificationClass(item.verification)}`}
            >
              {verificationLabel(item.verification)}
            </span>
            <span
              class={`rounded px-1.5 py-0.5 text-[10px] font-medium ${confidenceClass(item.confidence)}`}
            >
              {confidenceLabel(item.confidence)}
            </span>
          </div>
        </div>
      </div>
    {/each}
  </div>
</div>
