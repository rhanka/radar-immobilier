<script lang="ts">
  /**
   * GeoCityMapBaseStub — doublure de test du socle carto (vi.mock).
   *
   * MapLibre ne tourne pas sous jsdom : ce stub remplace GeoCityMapBase dans les
   * tests d'intégration de SignauxMapView. Il expose une API impérative inerte
   * (onReady) et forwarde les slots pour que la vue monte sans WebGL. Aucune
   * assertion carte n'est faite ici : le test ne vérifie que le câblage réseau
   * (zones chargées, fetchAllLots appelé ou non).
   */
  import { onMount } from "svelte";

  export let onReady: (api: unknown) => void = () => {};
  // §5 2-modes — exposé pour les tests du switch de fond : le stub ne rejoue pas
  // l'init MapLibre mais REFLÈTE le mode reçu en attribut DOM (`data-basemap-mode`)
  // pour que la vue puisse asserter le mode RÉSOLU (défaut plan / restauration
  // satellite / coercition prod). Les autres props du socle (onBasemapFallback…)
  // sont ignorées au runtime (restProps) — inutile de les redéclarer ici.
  export let basemapMode: "plan" | "satellite" = "plan";

  const api = {
    flyTo: () => {},
    fitMapToBounds: () => {},
    resetToInitialView: () => true,
    recenterKeepZoom: () => {},
    syncGeoLayers: () => {},
    getCityBoundary: () => null,
    hasCityBoundary: () => false,
    setCptaqData: () => {},
    themeElement: null,
  };

  onMount(() => onReady(api));
</script>

<div data-testid="stub-map" data-basemap-mode={basemapMode}>
  <slot name="overlay-top-left" />
  <slot name="overlay-bottom-left" />
  <slot />
</div>
