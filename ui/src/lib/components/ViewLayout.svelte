<script lang="ts">
  /**
   * ViewLayout — gabarit de mise en page par vue.
   *
   * Deux slots :
   *  - `controls` (optionnel) : bande laterale gauche (~w-72) pour les controles propres a la vue
   *    (tri, filtres, selecteurs...).
   *  - `default` (obligatoire) : zone de contenu principale.
   *
   * Comportement :
   *  - Avec slot `controls` : layout horizontal (controls gauche | contenu droite flex-1).
   *  - Sans slot `controls` : contenu centre avec marges symetriques (mx-auto max-w-screen-2xl px-6).
   *
   * Usage :
   *   <ViewLayout>
   *     <svelte:fragment slot="controls">...</svelte:fragment>
   *     <MonContenu />
   *   </ViewLayout>
   */

  /** Largeur CSS de la bande laterale de controles. Par defaut : w-72 (18rem). */
  export let controlsWidth: string = "w-72";

  /** Passer `true` si la vue gere elle-meme son layout full-width (ex. Opportunites). */
  export let fullWidth: boolean = false;
</script>

{#if fullWidth}
  <!-- Vue full-width : contenu directement sans contrainte de marges -->
  <div class="flex min-h-0 flex-1 overflow-auto">
    <slot />
  </div>
{:else}
  <div class="flex min-h-0 flex-1 overflow-auto">
    {#if $$slots.controls}
      <!-- Layout avec bande laterale de controles -->
      <div class="flex h-full w-full">
        <aside class={`${controlsWidth} shrink-0 border-r border-slate-200 bg-white overflow-y-auto`}>
          <slot name="controls" />
        </aside>
        <div class="flex-1 overflow-auto">
          <slot />
        </div>
      </div>
    {:else}
      <!-- Layout centre avec marges symetriques -->
      <div class="mx-auto w-full max-w-screen-2xl px-6 py-4">
        <slot />
      </div>
    {/if}
  </div>
{/if}
