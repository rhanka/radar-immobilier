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
   *
   * Pour un footer de légende toujours visible en bas de la bande controls, utiliser
   * `stickyControlsFooter` : la bande devient flex-col, son contenu défile, et le
   * slot `controls-footer` est épinglé en bas.
   *
   *   <ViewLayout stickyControlsFooter>
   *     <svelte:fragment slot="controls">...</svelte:fragment>
   *     <svelte:fragment slot="controls-footer"><!-- légende --></svelte:fragment>
   *     <MonContenu />
   *   </ViewLayout>
   */

  /** Largeur CSS de la bande laterale de controles. Par defaut : w-72 (18rem). */
  export let controlsWidth: string = "w-72";

  /** Passer `true` si la vue gere elle-meme son layout full-width (ex. Opportunites). */
  export let fullWidth: boolean = false;

  /**
   * Passer `true` pour activer le footer épinglé de la bande controls.
   * Active le slot `controls-footer` visible en bas, le contenu `controls` devient
   * défilable (overflow-y-auto flex-1). Corrige le bug légende coupée.
   */
  export let stickyControlsFooter: boolean = false;
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
        {#if stickyControlsFooter}
          <!-- Bande controls avec footer épinglé (flex-col) : scroll interne + légende toujours visible -->
          <aside class={`${controlsWidth} shrink-0 border-r border-slate-200 bg-white flex flex-col`}>
            <div class="flex-1 overflow-y-auto">
              <slot name="controls" />
            </div>
            {#if $$slots['controls-footer']}
              <div class="shrink-0 border-t border-slate-100">
                <slot name="controls-footer" />
              </div>
            {/if}
          </aside>
        {:else}
          <!-- Bande controls simple avec défilement global -->
          <aside class={`${controlsWidth} shrink-0 border-r border-slate-200 bg-white overflow-y-auto`}>
            <slot name="controls" />
          </aside>
        {/if}
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
