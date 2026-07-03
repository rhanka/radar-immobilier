/**
 * viewport-memory — mémoire du CADRAGE INITIAL de la carte (C9).
 *
 * Au primo-chargement, la carte s'ouvre sur un viewport (centre + zoom). Le
 * retour « Province » / la désélection doivent restaurer EXACTEMENT ce cadrage
 * — pas un fitBounds approximatif de la province. Ce module capture le premier
 * viewport observé et le restitue tel quel (copie défensive, jamais muté).
 */

export interface MapViewport {
  center: [number, number];
  zoom: number;
}

export interface ViewportMemory {
  /** Capture le viewport SI ET SEULEMENT SI aucun n'a encore été capturé. */
  captureOnce(viewport: MapViewport): void;
  /** Viewport initial capturé (copie), ou null avant toute capture. */
  initial(): MapViewport | null;
}

export function createViewportMemory(): ViewportMemory {
  let stored: MapViewport | null = null;
  return {
    captureOnce(viewport: MapViewport): void {
      if (stored) return;
      if (!isValidViewport(viewport)) return;
      stored = cloneViewport(viewport);
    },
    initial(): MapViewport | null {
      return stored ? cloneViewport(stored) : null;
    },
  };
}

function cloneViewport(viewport: MapViewport): MapViewport {
  return {
    center: [viewport.center[0], viewport.center[1]],
    zoom: viewport.zoom,
  };
}

function isValidViewport(viewport: MapViewport): boolean {
  return (
    Number.isFinite(viewport.center?.[0]) &&
    Number.isFinite(viewport.center?.[1]) &&
    Number.isFinite(viewport.zoom)
  );
}
