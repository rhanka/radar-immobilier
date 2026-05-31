<script lang="ts">
  import { ExternalLink } from "@lucide/svelte";
  import { getAcronym } from "$lib/glossary/acronyms.js";

  export let term: string;

  $: entry = getAcronym(term);

  let open = false;
  let triggerEl: HTMLSpanElement;

  const tooltipId = `acronym-tip-${term.replace(/\s+/g, "-").toLowerCase()}-${Math.random().toString(36).slice(2, 7)}`;

  function show() {
    open = true;
  }
  function hide() {
    open = false;
  }
  function toggle() {
    open = !open;
  }
  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && open) {
      open = false;
      triggerEl?.focus();
    }
  }
</script>

{#if entry}
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <span class="relative inline-block">
    <span
      bind:this={triggerEl}
      tabindex="0"
      role="button"
      aria-describedby={tooltipId}
      class="cursor-help border-b border-dotted border-slate-400 focus:outline-none focus:ring-1 focus:ring-teal-400 focus:ring-offset-1 rounded-sm"
      on:mouseenter={show}
      on:mouseleave={hide}
      on:focus={show}
      on:blur={hide}
      on:click={toggle}
      on:keydown={onKeydown}
    >{term}</span>

    {#if open}
      <div
        id={tooltipId}
        role="tooltip"
        class="absolute bottom-full left-0 z-50 mb-2 w-72 rounded-lg border border-slate-200 bg-white p-3 shadow-lg text-left"
      >
        <p class="text-[13px] font-semibold text-slate-900">{term}</p>
        <p class="mt-0.5 text-[12px] font-medium text-teal-700 leading-tight">{entry.full}</p>
        <p class="mt-1.5 text-[12px] leading-5 text-slate-600">{entry.definition}</p>
        {#if entry.url}
          <a
            href={entry.url}
            target="_blank"
            rel="noopener noreferrer"
            class="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-teal-600 hover:text-teal-800 hover:underline"
          >
            <ExternalLink class="h-3 w-3" aria-hidden="true" />
            Référence
          </a>
        {/if}
      </div>
    {/if}
  </span>
{:else}
  {term}
{/if}
