<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import {
    ChevronLeft,
    ChevronRight,
    ExternalLink,
    Loader2,
    Minus,
    Plus,
    X,
  } from "@lucide/svelte";
  import { findCitationInPage } from "$lib/signals/pdf-citation-match.js";

  export let title = "Document source";
  export let sourceUrl: string | null = null;
  export let sourceRef: string | null = null;
  export let rawRef: string | null = null;
  export let rawObjectKey: string | null = null;
  export let documentDate: string | null = null;
  export let page: number | null = null;
  export let bbox: [number, number, number, number] | null = null;
  /**
   * Extrait cité — utilisé UNIQUEMENT pour surligner le passage dans le PDF.
   * Il n'est PAS réaffiché ici : la citation vit déjà dans le panneau de droite.
   */
  export let excerpt: string | null = null;
  export let onClose: () => void = () => {};

  // URL raw préfixée par VITE_API_BASE_URL comme tous les autres clients API :
  // sans ça, le `/api/...` relatif ne marche que same-origin et casse dès que
  // l'UI et l'API sont sur des origines distinctes.
  function rawDocumentUrl(ref: string): string {
    const base = import.meta.env.VITE_API_BASE_URL;
    const path = `/api/documents/raw?rawRef=${encodeURIComponent(ref)}`;
    return base ? `${base.replace(/\/$/, "")}${path}` : path;
  }
  // Source RENDUE par pdf.js : préfère TOUJOURS la route interne /api/documents/raw
  // (via rawRef) au `sourceUrl` public. pdf.js récupère les octets par fetch/XHR :
  // l'URL publique de la ville (ex. https://vdmt.ca/…/PV.pdf) est cross-origin et
  // ne renvoie aucun en-tête CORS (Access-Control-Allow-Origin), donc le navigateur
  // BLOQUE le fetch → loadError → « preuve non rendue ». La route interne est
  // same-origin + authentifiée et sert les octets depuis le bucket (preuve prouvée
  // 200 application/pdf). Le `sourceUrl` public reste utilisé pour le lien « Ouvrir »
  // (balise <a href>, non soumise au CORS) plus bas.
  $: resolvedSourceUrl =
    (rawRef ? rawDocumentUrl(rawRef) : null) ?? sourceUrl;
  $: fallbackRef = rawRef ?? rawObjectKey ?? sourceRef;
  $: isPdfSource = looksLikePdf(resolvedSourceUrl, rawRef, sourceRef);

  // ── État du viewer pdf.js ────────────────────────────────────────────────
  let canvasEl: HTMLCanvasElement | null = null;
  let textLayerEl: HTMLDivElement | null = null;
  let viewerScrollEl: HTMLDivElement | null = null;

  let pdfDoc: import("pdfjs-dist").PDFDocumentProxy | null = null;
  let numPages = 0;
  let currentPage = 1;
  let loading = false;
  let loadError: string | null = null;
  let renderToken = 0;

  // Identité du document courant — recharge quand l'URL résolue change.
  let loadedUrl: string | null = null;

  // ── Zoom ──────────────────────────────────────────────────────────────────
  // `scale` est l'échelle EFFECTIVE appliquée au rendu (canvas + surlignage).
  // Deux régimes :
  //   - fit-width : `userScale === null` → l'échelle suit la largeur dispo
  //     (recalculée à chaque resize via ResizeObserver). C'est le défaut (#81).
  //   - zoom manuel : `userScale` fixé par la molette ou les boutons (#85) ;
  //     l'échelle ne suit plus la largeur tant que l'utilisateur ne revient pas
  //     à 100 % via le bouton « % » (qui restaure le fit-width).
  const MIN_SCALE = 0.4;
  const MAX_SCALE = 4;
  let scale = 1; // échelle réellement rendue (réactif → % toolbar)
  let userScale: number | null = null; // override manuel, null = fit-width
  let fitWidthScale = 1; // dernière échelle fit-width calculée
  let resizeObserver: ResizeObserver | null = null;

  function looksLikePdf(url: string | null, raw: string | null, sref: string | null): boolean {
    const probe = `${url ?? ""} ${raw ?? ""} ${sref ?? ""}`.toLowerCase();
    if (probe.includes(".pdf")) return true;
    // Route streaming interne : on tente le rendu PDF, fallback iframe si échec.
    // Match indépendant de la base (relatif `/api/...` OU absolu `https://…/api/…`).
    if (url && url.includes("/api/documents/raw")) return true;
    return false;
  }

  async function loadPdf(url: string): Promise<void> {
    loading = true;
    loadError = null;
    try {
      const pdfjs = await import("pdfjs-dist");
      // Worker servi par Vite via URL d'asset (pas de CDN).
      const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      const task = pdfjs.getDocument({ url, isEvalSupported: false });
      const doc = await task.promise;
      pdfDoc = doc;
      numPages = doc.numPages;
      loadedUrl = url;
      const initial = page && page >= 1 && page <= numPages ? page : 1;
      currentPage = initial;
      await renderPage(initial);
      attachResizeObserver();
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
      pdfDoc = null;
    } finally {
      loading = false;
    }
  }

  /** Échelle fit-width pour une largeur de base donnée (largeur conteneur / largeur page). */
  function computeFitWidth(baseWidth: number): number {
    const available = viewerScrollEl
      ? // padding interne du scroller (0.75rem de chaque côté ≈ 24px)
        Math.max(120, viewerScrollEl.clientWidth - 24)
      : (canvasEl?.parentElement?.clientWidth ?? 700);
    return Math.max(MIN_SCALE, Math.min(MAX_SCALE, available / baseWidth));
  }

  async function renderPage(pageNumber: number): Promise<void> {
    if (!pdfDoc) return;
    const token = ++renderToken;
    const clamped = Math.min(Math.max(pageNumber, 1), numPages || 1);
    currentPage = clamped;
    const pdfPage = await pdfDoc.getPage(clamped);
    if (token !== renderToken) return; // une navigation plus récente a pris le pas

    await tick();
    const canvas = canvasEl;
    const layer = textLayerEl;
    if (!canvas) return;

    // Échelle effective : zoom manuel (#85) ou fit-width (#81, défaut lisible).
    const baseViewport = pdfPage.getViewport({ scale: 1 });
    fitWidthScale = computeFitWidth(baseViewport.width);
    const effectiveScale = userScale ?? fitWidthScale;
    scale = effectiveScale; // expose pour le % de la toolbar
    const viewport = pdfPage.getViewport({ scale: effectiveScale });

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    await pdfPage.render({ canvasContext: ctx, viewport }).promise;
    if (token !== renderToken) return;

    // ── Surlignage du passage cité ──────────────────────────────────────────
    if (layer) {
      layer.innerHTML = "";
      layer.style.width = `${Math.floor(viewport.width)}px`;
      layer.style.height = `${Math.floor(viewport.height)}px`;

      // Le surlignage (bbox OU texte) n'est dessiné QUE sur la page cible de la
      // référence du signal (`page`). Sans ce garde, la voie texte re-surlignait
      // à CHAQUE page un passage générique → faux positifs (bug #83).
      const onTargetPage = currentPage === (page ?? currentPage);
      if (bbox && onTargetPage) {
        // bbox fourni en fractions [x0, y0, x1, y1] de la page → rectangle.
        drawBboxHighlight(layer, viewport.width, viewport.height);
      } else if (onTargetPage && excerpt && excerpt.trim().length > 0) {
        await drawTextHighlight(layer, pdfPage, viewport, effectiveScale);
      }
    }
  }

  /** Re-rend la page courante (utilisé par zoom + resize), sans changer de page. */
  function rerenderCurrent(): void {
    if (pdfDoc) void renderPage(currentPage);
  }

  // ResizeObserver : en régime fit-width, recalcule l'échelle et re-rend
  // (canvas ET surlignage restent synchronisés) à tout redimensionnement du
  // conteneur. Ignoré en zoom manuel (l'utilisateur a figé l'échelle).
  function attachResizeObserver(): void {
    if (resizeObserver || typeof ResizeObserver === "undefined" || !viewerScrollEl) return;
    let lastWidth = viewerScrollEl.clientWidth;
    resizeObserver = new ResizeObserver(() => {
      if (userScale !== null) return; // zoom manuel : pas de re-fit
      const w = viewerScrollEl?.clientWidth ?? lastWidth;
      if (Math.abs(w - lastWidth) < 1) return; // bruit sub-pixel
      lastWidth = w;
      rerenderCurrent();
    });
    resizeObserver.observe(viewerScrollEl);
  }

  function drawBboxHighlight(layer: HTMLDivElement, w: number, h: number): void {
    if (!bbox) return;
    const [x0, y0, x1, y1] = bbox;
    const mark = document.createElement("div");
    mark.className = "pdf-hl";
    mark.style.left = `${Math.min(x0, x1) * w}px`;
    mark.style.top = `${Math.min(y0, y1) * h}px`;
    mark.style.width = `${Math.abs(x1 - x0) * w}px`;
    mark.style.height = `${Math.abs(y1 - y0) * h}px`;
    layer.appendChild(mark);
    queueScrollToHighlight(layer);
  }

  async function drawTextHighlight(
    layer: HTMLDivElement,
    pdfPage: import("pdfjs-dist").PDFPageProxy,
    viewport: { width: number; height: number; transform: number[] },
    renderScale: number,
  ): Promise<void> {
    if (!excerpt) return;
    const content = await pdfPage.getTextContent();
    // Concatène le texte de la page + garde, pour chaque item, son offset.
    // pdf.js mélange TextItem (avec `str`) et TextMarkedContent (sans) ; on ne
    // garde que les TextItem porteurs de texte.
    type Item = { str: string; transform: number[]; width: number; height: number };
    const items: Item[] = [];
    for (const raw of content.items) {
      if (typeof (raw as { str?: unknown }).str === "string") {
        items.push(raw as unknown as Item);
      }
    }
    let pageText = "";
    const offsets: { start: number; end: number; item: Item }[] = [];
    for (const it of items) {
      const start = pageText.length;
      pageText += it.str;
      offsets.push({ start, end: pageText.length, item: it });
      // espace de séparation entre items (les items pdf.js n'ont pas d'espace final)
      pageText += " ";
    }

    const match = findCitationInPage(pageText, excerpt);
    if (!match) return;

    // Surligne tout item qui chevauche l'intervalle [match.start, match.end).
    let drewOne = false;
    for (const { start, end, item } of offsets) {
      if (end <= match.start || start >= match.end) continue;
      const [, b, , d, e, f] = item.transform;
      // POSITION : projetée dans l'espace viewport via viewport.transform, qui
      // intègre DÉJÀ `renderScale` (pdf.js : Util.transform). Pas de *scale ici.
      const vt = viewport.transform;
      const tx = vt[0]! * e! + vt[2]! * f! + vt[4]!;
      const ty = vt[1]! * e! + vt[3]! * f! + vt[5]!;
      // DIMENSIONS : `item.transform` (b,d) et `item.width` sont exprimés en
      // espace PDF (scale 1) — ils ne passent PAS par viewport.transform. Il
      // FAUT donc les multiplier par `renderScale`, sinon le surlignage garde
      // une taille scale-1 alors que sa position est à l'échelle → décalage
      // vertical/horizontal qui empire avec le zoom (bug #82). L'ancien facteur
      // `viewport.width/(viewport.width||1)` valait 1 (no-op) : supprimé.
      const fontHeight = (Math.hypot(b!, d!) || item.height || 10) * renderScale;
      const width = Math.max(item.width * renderScale, 4);
      const mark = document.createElement("div");
      mark.className = "pdf-hl";
      mark.style.left = `${tx}px`;
      mark.style.top = `${ty - fontHeight}px`;
      mark.style.width = `${width}px`;
      mark.style.height = `${fontHeight * 1.15}px`;
      layer.appendChild(mark);
      drewOne = true;
    }
    if (drewOne) queueScrollToHighlight(layer);
  }

  function queueScrollToHighlight(layer: HTMLDivElement): void {
    requestAnimationFrame(() => {
      const first = layer.querySelector(".pdf-hl") as HTMLElement | null;
      if (first && viewerScrollEl) {
        const top = first.offsetTop - viewerScrollEl.clientHeight / 3;
        viewerScrollEl.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
      }
    });
  }

  function goPrev(): void {
    if (currentPage > 1) void renderPage(currentPage - 1);
  }
  function goNext(): void {
    if (currentPage < numPages) void renderPage(currentPage + 1);
  }

  // ── Zoom (#85) ─────────────────────────────────────────────────────────────
  /** Applique une nouvelle échelle manuelle (bornée) et re-rend. */
  function setUserScale(next: number): void {
    const clamped = Math.max(MIN_SCALE, Math.min(MAX_SCALE, next));
    if (userScale !== null && Math.abs(clamped - userScale) < 0.001) return;
    userScale = clamped;
    rerenderCurrent();
  }
  function zoomIn(): void {
    setUserScale((userScale ?? scale) + 0.2);
  }
  function zoomOut(): void {
    setUserScale((userScale ?? scale) - 0.2);
  }
  /** Revient au régime fit-width (#81) : l'échelle resuit la largeur dispo. */
  function resetZoom(): void {
    if (userScale === null) return;
    userScale = null;
    rerenderCurrent();
  }
  /**
   * Zoom molette : Ctrl+molette (ergonomie standard des viewers/cartes), pour
   * ne pas voler le scroll vertical naturel du document. On borne via le même
   * clamp que les boutons. `passive:false` requis car on preventDefault.
   */
  function handleWheel(event: WheelEvent): void {
    if (!event.ctrlKey) return;
    event.preventDefault();
    const step = event.deltaY < 0 ? 0.15 : -0.15;
    setUserScale((userScale ?? scale) + step);
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") onClose();
    else if (event.key === "ArrowLeft") goPrev();
    else if (event.key === "ArrowRight") goNext();
    else if ((event.ctrlKey || event.metaKey) && (event.key === "+" || event.key === "=")) {
      event.preventDefault();
      zoomIn();
    } else if ((event.ctrlKey || event.metaKey) && event.key === "-") {
      event.preventDefault();
      zoomOut();
    }
  }

  // Charge / recharge le PDF quand la source résolue change.
  $: if (isPdfSource && resolvedSourceUrl && resolvedSourceUrl !== loadedUrl) {
    void loadPdf(resolvedSourceUrl);
  }

  onDestroy(() => {
    renderToken++;
    resizeObserver?.disconnect();
    resizeObserver = null;
    void pdfDoc?.destroy();
    pdfDoc = null;
  });
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="pdf-overlay-backdrop" aria-hidden="true" on:click={onClose}></div>
<div class="pdf-overlay" aria-label="Preuve documentaire" role="dialog" aria-modal="true">
  <header class="pdf-overlay-head">
    <div class="pdf-overlay-title-block">
      <span class="pdf-overlay-kicker">Preuve</span>
      <h2 class="pdf-overlay-title">{title}</h2>
      <div class="pdf-overlay-meta">
        <span>Date : {documentDate ?? "non disponible"}</span>
        {#if pdfDoc && numPages > 0}
          <span>Page {currentPage} / {numPages}</span>
        {:else if page}
          <span>Page : {page}</span>
        {/if}
      </div>
    </div>

    <div class="pdf-overlay-actions">
      {#if pdfDoc && numPages > 1}
        <div class="pdf-pager" role="group" aria-label="Navigation des pages">
          <button
            type="button"
            class="pdf-pager-btn"
            on:click={goPrev}
            disabled={currentPage <= 1}
            aria-label="Page précédente"
          >
            <ChevronLeft class="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="pdf-pager-btn"
            on:click={goNext}
            disabled={currentPage >= numPages}
            aria-label="Page suivante"
          >
            <ChevronRight class="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      {/if}
      {#if pdfDoc}
        <div class="pdf-zoom" role="group" aria-label="Zoom du document">
          <button
            type="button"
            class="pdf-pager-btn"
            on:click={zoomOut}
            disabled={scale <= MIN_SCALE + 0.001}
            aria-label="Dézoomer"
          >
            <Minus class="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="pdf-zoom-level"
            on:click={resetZoom}
            title="Revenir à l'ajustement à la largeur"
            aria-label="Niveau de zoom {Math.round(scale * 100)} pour cent, cliquer pour ajuster à la largeur"
          >
            {Math.round(scale * 100)}%
          </button>
          <button
            type="button"
            class="pdf-pager-btn"
            on:click={zoomIn}
            disabled={scale >= MAX_SCALE - 0.001}
            aria-label="Zoomer"
          >
            <Plus class="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      {/if}
      {#if sourceUrl}
        <a class="pdf-open-link" href={sourceUrl} target="_blank" rel="noopener noreferrer">
          Ouvrir <ExternalLink class="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      {/if}
      <button
        type="button"
        class="pdf-overlay-close"
        on:click={onClose}
        aria-label="Fermer la preuve documentaire"
      >
        <X class="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  </header>

  <div class="pdf-overlay-body">
    {#if isPdfSource && resolvedSourceUrl && !loadError}
      <div
        class="pdf-canvas-scroll"
        bind:this={viewerScrollEl}
        aria-label="Aperçu du document source"
        on:wheel={handleWheel}
      >
        <div class="pdf-canvas-stage">
          <canvas bind:this={canvasEl}></canvas>
          <div class="pdf-text-layer" bind:this={textLayerEl} aria-hidden="true"></div>
        </div>
        {#if loading}
          <div class="pdf-loading">
            <Loader2 class="h-5 w-5 animate-spin" aria-hidden="true" />
            <span>Chargement de la preuve…</span>
          </div>
        {/if}
      </div>
    {:else if resolvedSourceUrl && !loadError}
      <!-- Source non-PDF (HTML…) : aperçu direct en iframe, sans éditeur. -->
      <iframe class="pdf-frame" title={title} src={resolvedSourceUrl}></iframe>
    {:else}
      <div class="pdf-missing">
        {#if loadError}
          <p>La preuve n'a pas pu être rendue dans le visualiseur.</p>
          {#if sourceUrl}
            <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
              Ouvrir le document <ExternalLink class="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          {/if}
        {:else}
          <p>Aucune URL PDF publique ou route de streaming n'est disponible pour cette preuve.</p>
        {/if}
        {#if fallbackRef}
          <code>{fallbackRef}</code>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .pdf-overlay-backdrop {
    position: absolute;
    inset: 0;
    z-index: 39;
    background: rgb(15 23 42 / 0.15);
  }

  .pdf-overlay {
    position: absolute;
    inset: 1.25rem;
    z-index: 40;
    display: flex;
    min-width: 18rem;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--st-semantic-border-subtle, #cbd5e1);
    border-radius: var(--st-radius-md, 6px);
    background: var(--st-semantic-surface-default, #fff);
    box-shadow: 0 18px 50px rgb(15 23 42 / 0.3);
  }

  .pdf-overlay-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.7rem 0.85rem;
    border-bottom: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
    background: var(--st-semantic-surface-subtle, #f8fafc);
  }

  .pdf-overlay-title-block {
    min-width: 0;
  }

  .pdf-overlay-kicker {
    display: block;
    color: var(--st-semantic-text-muted, #64748b);
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .pdf-overlay-title {
    margin: 0.15rem 0 0.35rem;
    color: var(--st-semantic-text-primary, #0f172a);
    font-size: 0.95rem;
    font-weight: 650;
    line-height: 1.25;
  }

  .pdf-overlay-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
    color: var(--st-semantic-text-secondary, #475569);
    font-size: 0.72rem;
  }

  .pdf-overlay-actions {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-shrink: 0;
  }

  .pdf-pager,
  .pdf-zoom {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
  }

  .pdf-zoom-level {
    min-width: 3rem;
    height: 1.9rem;
    padding: 0 0.35rem;
    border: 1px solid var(--st-semantic-border-subtle, #cbd5e1);
    border-radius: var(--st-radius-sm, 4px);
    background: var(--st-semantic-surface-default, #fff);
    color: var(--st-semantic-text-secondary, #475569);
    font-size: 0.72rem;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
  }

  .pdf-zoom-level:hover {
    background: var(--st-semantic-surface-hover, #f1f5f9);
  }

  .pdf-pager-btn,
  .pdf-overlay-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.9rem;
    height: 1.9rem;
    border: 1px solid var(--st-semantic-border-subtle, #cbd5e1);
    border-radius: var(--st-radius-sm, 4px);
    background: var(--st-semantic-surface-default, #fff);
    color: var(--st-semantic-text-secondary, #475569);
    cursor: pointer;
  }

  .pdf-pager-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .pdf-pager-btn:not(:disabled):hover,
  .pdf-overlay-close:hover {
    background: var(--st-semantic-surface-hover, #f1f5f9);
  }

  .pdf-open-link {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0 0.55rem;
    height: 1.9rem;
    border: 1px solid var(--st-semantic-border-subtle, #cbd5e1);
    border-radius: var(--st-radius-sm, 4px);
    color: var(--st-semantic-text-link, #0f766e);
    font-size: 0.74rem;
    font-weight: 650;
    text-decoration: none;
  }

  .pdf-open-link:hover {
    background: var(--st-semantic-surface-hover, #f1f5f9);
  }

  .pdf-overlay-body {
    display: flex;
    min-height: 0;
    flex: 1;
  }

  .pdf-canvas-scroll {
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: auto;
    padding: 0.75rem;
    background: var(--st-semantic-surface-sunken, #e2e8f0);
  }

  .pdf-canvas-stage {
    position: relative;
    margin: 0 auto;
    width: max-content;
    max-width: 100%;
    box-shadow: 0 2px 12px rgb(15 23 42 / 0.18);
  }

  .pdf-canvas-stage canvas {
    display: block;
    background: #fff;
  }

  .pdf-text-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .pdf-text-layer :global(.pdf-hl) {
    position: absolute;
    background: var(--st-semantic-warning-surface, rgb(234 179 8 / 0.4));
    mix-blend-mode: multiply;
    border-radius: 2px;
  }

  .pdf-frame {
    flex: 1;
    width: 100%;
    height: 100%;
    border: 0;
    background: #fff;
  }

  .pdf-loading {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    gap: 0.5rem;
    justify-items: center;
    color: var(--st-semantic-text-secondary, #475569);
    font-size: 0.82rem;
    background: rgb(226 232 240 / 0.6);
  }

  .pdf-missing {
    display: grid;
    flex: 1;
    min-height: 100%;
    place-content: center;
    gap: 0.65rem;
    padding: 1.25rem;
    color: var(--st-semantic-text-secondary, #475569);
    text-align: center;
  }

  .pdf-missing p {
    margin: 0;
    font-size: 0.86rem;
  }

  .pdf-missing a {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    color: var(--st-semantic-text-link, #0f766e);
    font-weight: 650;
    text-decoration: none;
  }

  .pdf-missing a:hover {
    text-decoration: underline;
  }

  .pdf-missing code {
    overflow-wrap: anywhere;
    white-space: normal;
    font-size: 0.74rem;
  }

  @media (max-width: 900px) {
    .pdf-overlay {
      inset: 0.5rem;
    }
  }
</style>
