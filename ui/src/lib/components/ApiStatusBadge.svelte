<script lang="ts">
  import { CircleCheck, CircleOff, TriangleAlert } from "@lucide/svelte";
  import type { HealthView } from "$lib/api/health";

  export let health: HealthView;

  $: tone =
    health.kind === "ok"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : health.kind === "degraded"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-slate-200 bg-slate-100 text-slate-600";
</script>

<div class={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs ${tone}`}>
  {#if health.kind === "ok"}
    <CircleCheck class="h-4 w-4 shrink-0" aria-hidden="true" />
  {:else if health.kind === "degraded"}
    <TriangleAlert class="h-4 w-4 shrink-0" aria-hidden="true" />
  {:else}
    <CircleOff class="h-4 w-4 shrink-0" aria-hidden="true" />
  {/if}
  <div class="min-w-0">
    <p class="truncate font-semibold">{health.label}</p>
    <p class="truncate opacity-80">{health.detail}</p>
  </div>
</div>
