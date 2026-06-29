<script lang="ts">
  /**
   * Harnais QA — SWITCH de PDF + perf (#89 / #90).
   *
   * Contrairement à `pdf-overlay-main.ts` (montage unique, props figées par la
   * query string), ce wrapper détient les props du viewer en `$state` et permet
   * de les RÉASSIGNER à chaud via `window.__setPdfProps(...)`. C'est la
   * condition pour tester sur UNE MÊME page (donc sans ré-évaluer le module, ce
   * qui VIDERAIT le cache #89) :
   *   - le SWITCH de document A→B (#90 : waiter propre, pas d'ancien-doc
   *     résiduel) ;
   *   - la RÉOUVERTURE du même rawRef servie depuis le cache (#89c, perf).
   *
   * Le sink de perf `window.__pdfPerf` est posé par le test via `addInitScript`
   * AVANT le montage ; le composant l'alimente à chaque open→render.
   */
  import SignalPdfOverlay from "../../src/lib/components/maps/SignalPdfOverlay.svelte";

  type Props = {
    rawRef: string | null;
    sourceUrl: string | null;
    page: number;
    excerpt: string | null;
  };

  let props = $state<Props>({
    rawRef: null,
    sourceUrl: null,
    page: 1,
    excerpt: null,
  });

  // Pilotage in-place depuis Playwright. Réassigne les champs → la réactivité
  // Svelte propage au viewer, dont le bloc `$:` détecte le changement de rawRef
  // et déclenche loadPdf (avec son waiter #90 et son cache #89).
  if (typeof window !== "undefined") {
    (window as unknown as { __setPdfProps?: (p: Partial<Props>) => void }
    ).__setPdfProps = (p: Partial<Props>) => {
      props = { ...props, ...p };
    };
  }
</script>

<SignalPdfOverlay
  title="Preuve QA switch"
  rawRef={props.rawRef}
  sourceUrl={props.sourceUrl}
  page={props.page}
  excerpt={props.excerpt}
  onClose={() => {}}
/>
