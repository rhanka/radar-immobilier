<script lang="ts">
  import { ExternalLink } from "@lucide/svelte";
  import { Badge, Card } from "@sentropic/design-system-svelte";
  import type { PhaseGroup } from "$lib/opportunites/funnel.js";

  export let group: PhaseGroup;
  /**
   * In simulation mode, items that are not "fait" are shown with a demotion
   * tag ("hypothèse"/"simulation"/"non confirmé") but are NOT hidden.
   * In real mode, non-"fait" items (hypothese, non-disponible) are greyed
   * with a "non vérifié en mode réel" badge — they must not appear as facts.
   */
  export let simulationMode: boolean = false;

  function badgeTone(v: string): "success" | "warning" | "error" | "neutral" | "info" {
    if (v === "fait") return "success";
    if (v === "hypothese") return "warning";
    if (v === "simulé") return "info";
    return "neutral";
  }

  function verificationLabel(v: string): string {
    if (v === "fait") return "Fait";
    if (v === "hypothese") return "Hypothèse";
    if (v === "simulé") return "Simulé";
    return "N/D";
  }

  function confidenceTone(c: string): "success" | "warning" | "neutral" {
    if (c === "high") return "success";
    if (c === "medium") return "warning";
    return "neutral";
  }

  function confidenceLabel(c: string): string {
    if (c === "high") return "haute";
    if (c === "medium") return "moyenne";
    return "faible";
  }
</script>

<Card class="overflow-hidden">
  <!-- Phase header -->
  <div class="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
    <span class="h-2 w-2 shrink-0 rounded-full bg-teal-500"></span>
    <h1 class="text-sm font-semibold uppercase tracking-wide text-slate-700">
      {group.label}
    </h1>
    <Badge tone="neutral" class="ml-auto">
      {group.items.length} indice{group.items.length > 1 ? "s" : ""}
    </Badge>
  </div>

  <!-- Evidence items -->
  <div class="divide-y divide-slate-100">
    {#each group.items as item}
      {@const isSimDemoted = simulationMode && item.verification !== "fait"}
      {@const isRealDemoted = !simulationMode && item.verification !== "fait"}
      {@const isDemoted = isSimDemoted || isRealDemoted}
      <div class={`px-4 py-3 ${isDemoted ? "opacity-50" : ""}`}>
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
            {#if isRealDemoted}
              <p class="mt-1 text-[10px] font-semibold text-amber-600">
                non vérifié en mode réel
              </p>
            {/if}
          </div>
          <div class="flex shrink-0 flex-col items-end gap-1">
            <Badge tone={badgeTone(item.verification)}>
              {verificationLabel(item.verification)}
            </Badge>
            <Badge tone={confidenceTone(item.confidence)}>
              confiance {confidenceLabel(item.confidence)}
            </Badge>
          </div>
        </div>
      </div>
    {/each}
  </div>
</Card>
