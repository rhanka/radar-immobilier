<script lang="ts">
  /**
   * Harnais QA — §5 R3 P1+P3 : OUVERTURE + ANCRAGE du menu « Fond de carte »
   * (trigger lucide `Layers`) du socle carto `GeoCityMapBase`.
   *
   * Contrairement aux harnais géo de LOGIQUE PURE (WebGL indisponible en
   * chromium headless → carte non pilotable), ce harnais valide une surface
   * PUREMENT DOM/CSS : le popover DS du menu Layers. Il est indépendant de
   * MapLibre (l'init WebGL échoue silencieusement — try/catch dans `initMap` —
   * mais les CONTRÔLES bas-droit, dont le trigger `Layers`, sont rendus quel que
   * soit l'état de la carte). On peut donc, dans un VRAI navigateur, cliquer le
   * trigger et MESURER la position du panneau (bug P1 : hors-viewport en desktop
   * = « ne s'ouvre pas » ; P3 : bas-droite en responsive). Le fix (popover en
   * `position: fixed`) doit poser le panneau ON-SCREEN, ancré HAUT-GAUCHE.
   */
  import GeoCityMapBase from "../../src/lib/components/maps/GeoCityMapBase.svelte";
  import type { ExpressionSpecification } from "@maplibre/maplibre-gl-style-spec";

  // Expression `fill-color` factice : jamais consommée par MapLibre (l'init
  // échoue sous headless), mais requise par le contrat de props du socle.
  const FILL_COLOR = ["get", "score"] as unknown as ExpressionSpecification;

  let mode: "plan" | "satellite" = "plan";
</script>

<div style="position: relative; width: 100vw; height: 100vh;">
  <GeoCityMapBase
    fillColorExpression={FILL_COLOR}
    showBasemapControl={true}
    basemapMode={mode}
    onBasemapModeChange={(m) => (mode = m)}
  />
</div>
