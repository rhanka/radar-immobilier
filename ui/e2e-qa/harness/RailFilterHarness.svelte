<script lang="ts">
  /**
   * Harnais QA du SignauxRail (cases de filtre z/m/p) en ISOLATION — bug #3.
   *
   * Reproduit le câblage parent réel : `initialSubsetKey` est piloté ici comme
   * le ferait SignauxMapView (qui recalcule activeSubsetKey au onMount/reload),
   * et `onFilterChange` est observé. On expose des marqueurs DOM pour Playwright :
   *  - #emitted-log : journal des valeurs propagées via onFilterChange
   *  - #emit-count  : nombre de propagations (doit rester 0 au montage)
   *  - bouton #set-from-url : simule le recalcul parent (reload) qui change
   *    initialSubsetKey APRÈS le 1er rendu → les cases doivent se resynchroniser.
   */
  import SignauxRail from "../../src/lib/components/maps/SignauxRail.svelte";

  let initialSubsetKey = "z|m|p";
  let emitted: string[] = [];

  function onFilterChange(key: string): void {
    emitted = [...emitted, key];
  }

  // Simule le parent qui restaure le filtre depuis l'URL au reload (ex. "z|m").
  function simulateReloadRestore(): void {
    initialSubsetKey = "z|m";
  }
</script>

<div>
  <button id="set-from-url" type="button" onclick={simulateReloadRestore}>
    restore-from-url
  </button>
  <span id="emit-count">{emitted.length}</span>
  <span id="emitted-log">{emitted.join(",")}</span>
  <span id="current-initial">{initialSubsetKey}</span>

  <SignauxRail {initialSubsetKey} {onFilterChange} />
</div>
