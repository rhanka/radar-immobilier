<script lang="ts">
  import { Info } from "@lucide/svelte";
  import { criteriaDefinitions } from "$lib/source-review/source-evaluation-data";

  let activeCriterionId: string | null = null;

  const toggleCriterion = (criterionId: string) => {
    activeCriterionId = activeCriterionId === criterionId ? null : criterionId;
  };

  const clearCriterion = (criterionId: string) => {
    if (activeCriterionId === criterionId) {
      activeCriterionId = null;
    }
  };
</script>

<section class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
  <div class="mb-3 flex items-center gap-2">
    <Info class="h-4 w-4 text-teal-700" aria-hidden="true" />
    <h2 class="text-sm font-semibold text-slate-950">Criteres et acronymes</h2>
  </div>

  <div class="flex flex-wrap gap-2">
    {#each criteriaDefinitions as criterion}
      <div class="group relative">
        <button
          type="button"
          class="inline-flex h-8 items-center rounded-full border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-700 transition hover:border-teal-500 hover:bg-teal-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2"
          aria-label={criterion.label}
          aria-expanded={activeCriterionId === criterion.id}
          aria-controls={`criterion-tooltip-${criterion.id}`}
          on:click={() => toggleCriterion(criterion.id)}
          on:blur={() => clearCriterion(criterion.id)}
        >
          {criterion.label}
        </button>
        <p
          id={`criterion-tooltip-${criterion.id}`}
          class={`pointer-events-none invisible absolute left-1/2 top-full z-30 mt-2 w-72 max-w-[20rem] -translate-x-1/2 rounded-md border border-slate-200 bg-white p-3 text-left text-xs font-normal leading-5 text-slate-700 opacity-0 shadow-lg transition-opacity ${
            activeCriterionId === criterion.id
              ? "visible opacity-100"
              : "group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
          }`}
          role="status"
          tabindex="-1"
        >
          {criterion.explanation}
        </p>
      </div>
    {/each}
  </div>
</section>
