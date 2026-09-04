<script lang="ts">
  /**
   * AnnotationBadge — indicateur ambiant « annoté » (présentiel, count-driven,
   * contract-agnostic). Rien affiché si `count === 0`. Destiné aux surfaces où
   * une entité (signal/lot) est listée/résumée : carte signal de SignauxSelPanel,
   * rail, fiche lot. Le parent fournit le compteur (issu des notes chargées).
   */
  export let count = 0;

  $: labelText = `${count} note${count > 1 ? "s" : ""}`;
</script>

{#if count > 0}
  <span
    class="inline-flex items-center rounded-full bg-teal-50 px-1.5 py-0.5 text-[11px] font-medium leading-none text-teal-700"
    data-testid="annotation-badge"
    aria-label={labelText}
    title={labelText}>{count}</span>
{/if}
