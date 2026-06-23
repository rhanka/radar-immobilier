<script module lang="ts">
  // ── Singletons partagés entre TOUS les montages du viewer (#89) ─────────────
  // Ce bloc `module` est évalué UNE FOIS par chargement de l'app : son état
  // SURVIT à la fermeture/réouverture de l'overlay (le `<script>` d'instance,
  // lui, est ré-exécuté à chaque montage). C'est la condition pour que le worker
  // pdf.js ET le cache de documents persistent d'une ouverture à l'autre.
  type PdfjsModule = typeof import("pdfjs-dist");
  type PDFDocumentProxy = import("pdfjs-dist").PDFDocumentProxy;

  // pdf.js + worker chargés UNE SEULE FOIS, puis réutilisés à chaque open. Avant
  // (#89), chaque `loadPdf` refaisait `import("pdfjs-dist")` +
  // `import(".../pdf.worker…?url")` et ré-assignait `GlobalWorkerOptions
  // .workerSrc` → coût d'init payé à CHAQUE open. La PROMESSE est mémoïsée : un
  // 2e+ open la réutilise sans re-bundler ni re-câbler le worker.
  let pdfjsPromise: Promise<PdfjsModule> | null = null;
  function getPdfjs(): Promise<PdfjsModule> {
    if (!pdfjsPromise) {
      pdfjsPromise = (async () => {
        const pdfjs = await import("pdfjs-dist");
        // Worker servi par Vite via URL d'asset (pas de CDN).
        const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        return pdfjs;
      })();
    }
    return pdfjsPromise;
  }

  // Cache de documents par URL résolue (#89c). Réouvrir le MÊME rawRef ne refait
  // ni fetch ni parse : on réutilise le `PDFDocumentProxy` déjà chargé. On
  // mémoïse la PROMESSE (pas le doc résolu) pour qu'un 2e open concurrent sur la
  // même URL partage le MÊME chargement au lieu d'en lancer un second. LRU
  // simple borné : au-delà de MAX_CACHED_DOCS on détruit le plus ancien.
  const MAX_CACHED_DOCS = 6;
  const docCache = new Map<string, Promise<PDFDocumentProxy>>();

  function getCachedDocument(url: string): Promise<PDFDocumentProxy> {
    const cached = docCache.get(url);
    if (cached) {
      // Touch LRU : réinsertion en queue de Map (l'ordre d'itération Map = ordre
      // d'insertion → la 1re clé itérée est la moins récemment utilisée).
      docCache.delete(url);
      docCache.set(url, cached);
      return cached;
    }
    const promise = (async () => {
      const pdfjs = await getPdfjs();
      const task = pdfjs.getDocument({ url, isEvalSupported: false });
      return task.promise;
    })();
    docCache.set(url, promise);
    // Échec non mémoïsé : on retire l'entrée pour permettre un re-essai (un 404
    // transitoire ne doit pas geler l'URL en erreur dans le cache).
    promise.catch(() => {
      if (docCache.get(url) === promise) docCache.delete(url);
    });
    evictIfNeeded();
    return promise;
  }

  function evictIfNeeded(): void {
    while (docCache.size > MAX_CACHED_DOCS) {
      const oldestKey = docCache.keys().next().value;
      if (oldestKey === undefined) break;
      const evicted = docCache.get(oldestKey);
      docCache.delete(oldestKey);
      // Détruit le doc évincé pour libérer le worker. C'est le SEUL endroit où un
      // doc est détruit : plus aucune instance ne peut le redemander par cette
      // URL. `void` : la promesse peut être encore en vol, on ignore l'erreur de
      // destroy tardif.
      void evicted?.then((doc) => doc.destroy()).catch(() => {});
    }
  }

  // Instrumentation perf (#89) — empile chaque ouverture { url, ms, cached } sur
  // window.__pdfPerf pour que la QA navigateur chiffre open→render avant/après.
  // Aucun impact prod (objet de debug, non lu par l'UI ; activé seulement si le
  // harness a posé le sink au préalable via addInitScript).
  function recordPerf(url: string, ms: number, cached: boolean): void {
    if (typeof window === "undefined") return;
    const w = window as unknown as {
      __pdfPerf?: { url: string; ms: number; cached: boolean }[];
    };
    if (!w.__pdfPerf) return;
    w.__pdfPerf.push({ url, ms, cached });
  }
</script>

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
  import type { OverlaySignal } from "$lib/signals/pdf-overlay-signals.js";

  export let title = "Document source";
  export let sourceUrl: string | null = null;
  export let sourceRef: string | null = null;
  export let rawRef: string | null = null;
  export let rawObjectKey: string | null = null;
  export let documentDate: string | null = null;
  export let page: number | null = null;
  export let bbox: [number, number, number, number] | null = null;
  /**
   * Extrait cité du signal COURANT — utilisé UNIQUEMENT pour surligner le
   * passage dans le PDF. Il n'est PAS réaffiché ici : la citation vit déjà dans
   * le panneau de droite. Conservé pour la rétrocompat LOT 1 (un seul signal).
   */
  export let excerpt: string | null = null;
  /**
   * LOT 2 (#84) — TOUS les signaux du même PV (même rawRef), chacun avec sa
   * couleur + son libellé : surlignage multi-signaux. Quand la liste est vide,
   * on retombe sur le comportement LOT 1 (un surlignage depuis `excerpt`/`page`
   * /`bbox`) — voir `effectiveSignals`.
   */
  export let signals: OverlaySignal[] = [];
  export let onClose: () => void = () => {};

  // Liste effective des signaux à surligner. Avec `signals` non vide on est en
  // mode multi (LOT 2) ; sinon on synthétise un signal unique « courant » à
  // partir des props scalaires (LOT 1) — garde-fou de non-régression.
  $: effectiveSignals =
    signals.length > 0
      ? signals
      : excerpt && excerpt.trim().length > 0
        ? [
            {
              id: "current",
              label: "",
              excerpt,
              page,
              color: SINGLE_SIGNAL_COLOR,
              current: true,
            } satisfies OverlaySignal,
          ]
        : [];

  // Couleur du surlignage en mode mono-signal (LOT 1) : l'ambre historique.
  const SINGLE_SIGNAL_COLOR = "#eab308";

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

  // Token de LOAD distinct du renderToken (#89/#90). Le renderToken protège un
  // rendu de page contre une navigation de page plus récente DANS le même doc.
  // Le loadToken protège tout le pipeline d'OUVERTURE (fetch+parse+1er render)
  // contre un SWITCH de doc plus récent (A→B→C en rafale) : un chargement de A
  // qui se résout après que B a démarré ne doit RIEN peindre. Sans lui, le doc A
  // (lent) pourrait écraser B (rapide) — l'ancien-doc-résiduel que #90 bannit.
  let loadToken = 0;

  // Identité du document courant — recharge quand l'URL résolue change. Posée
  // AU DÉBUT du load (pas à la fin) pour que le bloc réactif ne reboucle pas
  // pendant le chargement ; remise à null si le load échoue/est dépassé.
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
    const token = ++loadToken;
    // Invalide aussi tout RENDER en vol de l'ancien doc (zoom/pagination en
    // cours) : un render déjà passé son garde `!pdfDoc` ne doit pas peindre
    // l'ancien doc sur le canvas pendant le chargement du nouveau.
    renderToken++;
    const startedAt =
      typeof performance !== "undefined" ? performance.now() : 0;

    // #90 — RESET FRANC au switch : on bannit l'ancien-doc-résiduel. On marque
    // l'URL cible TOUT DE SUITE (le bloc réactif ne reboucle pas), on bascule en
    // loading et on lâche la référence à l'ancien doc → la toolbar (pager/zoom)
    // et le canvas disparaissent, remplacés par le waiter plein-cadre. Le zoom
    // manuel d'un doc précédent ne doit pas fuiter sur le nouveau : on repart en
    // fit-width (régime par défaut #81).
    loadedUrl = url;
    loading = true;
    loadError = null;
    pdfDoc = null;
    numPages = 0;
    userScale = null;

    try {
      // #89c — réutilise le doc déjà chargé pour cette URL (cache module-level)
      // OU le charge via le worker singleton. Pas de re-import pdf.js par open.
      const fromCache = docCache.has(url);
      const doc = await getCachedDocument(url);
      if (token !== loadToken) return; // un switch plus récent a pris le pas

      pdfDoc = doc;
      numPages = doc.numPages;
      const initial = page && page >= 1 && page <= numPages ? page : 1;
      currentPage = initial;
      await renderPage(initial);
      if (token !== loadToken) return;
      attachResizeObserver();

      // #89 — mesure open→1ère page peinte, exposée pour la QA Playwright.
      if (typeof performance !== "undefined") {
        recordPerf(url, performance.now() - startedAt, fromCache);
      }
    } catch (err) {
      if (token !== loadToken) return; // erreur d'un load dépassé : on ignore
      loadError = err instanceof Error ? err.message : String(err);
      pdfDoc = null;
      // On GARDE `loadedUrl = url` (posé en tête) : le bloc réactif ne doit PAS
      // reboucler sur cette URL en échec, sinon il relancerait loadPdf en boucle
      // et remettrait loadError à null à chaque tour → le bloc .pdf-missing ne
      // s'afficherait jamais. L'entrée fautive a déjà été retirée du docCache
      // (catch dans getCachedDocument) : un vrai retry refera le fetch dès que
      // `resolvedSourceUrl` change à nouveau (réouverture d'un autre doc).
    } finally {
      if (token === loadToken) loading = false;
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

    // ── Surlignage des passages cités (multi-signaux, #84) ───────────────────
    if (layer) {
      layer.innerHTML = "";
      layer.style.width = `${Math.floor(viewport.width)}px`;
      layer.style.height = `${Math.floor(viewport.height)}px`;

      // bbox (mono-signal LOT 1) prioritaire si fourni ET sur la page cible.
      // Le garde de page reste PAR signal : un surlignage n'est dessiné QUE sur
      // la page de SA référence. Sans ce garde, la voie texte re-surlignait à
      // CHAQUE page un passage générique → faux positifs (bug #83). On le
      // conserve signal par signal en mode multi.
      const onBboxPage = currentPage === (page ?? currentPage);
      if (bbox && signals.length === 0 && onBboxPage) {
        // bbox fourni en fractions [x0, y0, x1, y1] de la page → rectangle.
        drawBboxHighlight(layer, viewport.width, viewport.height);
      } else {
        // Pré-charge la couche texte UNE fois pour tous les signaux de la page.
        const targets = effectiveSignals.filter(
          (s) =>
            currentPage === (s.page ?? currentPage) &&
            s.excerpt !== null &&
            s.excerpt.trim().length > 0,
        );
        if (targets.length > 0) {
          const content = await pdfPage.getTextContent();
          if (token !== renderToken) return;
          let drewCurrent = false;
          // Dessine les AUTRES d'abord, le COURANT en dernier → au-dessus.
          const ordered = [...targets].sort(
            (a, b) => Number(a.current) - Number(b.current),
          );
          for (const sig of ordered) {
            const drew = drawTextHighlight(
              layer,
              content,
              viewport,
              effectiveScale,
              sig,
            );
            if (drew && sig.current) drewCurrent = true;
          }
          // Centre le scroll sur le surlignage du signal courant en priorité.
          queueScrollToHighlight(layer, drewCurrent ? "current" : null);
        }
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
    mark.className = "pdf-hl pdf-hl--current";
    mark.style.left = `${Math.min(x0, x1) * w}px`;
    mark.style.top = `${Math.min(y0, y1) * h}px`;
    mark.style.width = `${Math.abs(x1 - x0) * w}px`;
    mark.style.height = `${Math.abs(y1 - y0) * h}px`;
    applyHighlightColor(mark, SINGLE_SIGNAL_COLOR, true);
    layer.appendChild(mark);
    queueScrollToHighlight(layer, null);
  }

  /** Teinte un surlignage : couleur pleine pour le courant, estompé sinon. */
  function applyHighlightColor(
    mark: HTMLElement,
    color: string,
    current: boolean,
  ): void {
    // Le courant garde un fond plus opaque ; les autres signaux sont estompés
    // (alpha plus faible) mais restent identifiables par teinte + badge (#84).
    mark.style.setProperty("--hl-color", color);
    mark.style.background = current ? withAlpha(color, 0.42) : withAlpha(color, 0.2);
    mark.style.outline = current ? `1px solid ${withAlpha(color, 0.85)}` : "none";
  }

  /** Convertit un hex #rrggbb en rgba(...) avec l'alpha donné. */
  function withAlpha(hex: string, alpha: number): string {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return hex;
    const int = Number.parseInt(m[1]!, 16);
    const r = (int >> 16) & 255;
    const g = (int >> 8) & 255;
    const b = int & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  type PdfTextContent = Awaited<
    ReturnType<import("pdfjs-dist").PDFPageProxy["getTextContent"]>
  >;

  /**
   * Surligne UN signal sur la page courante. Retourne true si au moins une
   * marque a été dessinée. La couche texte (`content`) est chargée une seule
   * fois par la page appelante et partagée entre tous les signaux.
   */
  function drawTextHighlight(
    layer: HTMLDivElement,
    content: PdfTextContent,
    viewport: { width: number; height: number; transform: number[] },
    renderScale: number,
    signal: OverlaySignal,
  ): boolean {
    if (!signal.excerpt) return false;
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

    const match = findCitationInPage(pageText, signal.excerpt);
    if (!match) return false;

    // Surligne tout item qui chevauche l'intervalle [match.start, match.end).
    // Mémorise le 1er rectangle pour y ancrer le badge ID du signal.
    let firstMark: HTMLElement | null = null;
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
      mark.className = signal.current ? "pdf-hl pdf-hl--current" : "pdf-hl";
      mark.dataset.signalId = signal.id;
      mark.style.left = `${tx}px`;
      mark.style.top = `${ty - fontHeight}px`;
      mark.style.width = `${width}px`;
      mark.style.height = `${fontHeight * 1.15}px`;
      applyHighlightColor(mark, signal.color, signal.current);
      layer.appendChild(mark);
      if (!firstMark) firstMark = mark;
      drewOne = true;
    }

    // Badge ID en surimpression, ancré au coin haut-gauche du 1er rectangle.
    // Affiché seulement quand un libellé est fourni (mode multi #84) — en mode
    // mono LOT 1 le libellé est vide, on n'ajoute pas de badge (non-régression).
    if (drewOne && firstMark && signal.label.trim().length > 0) {
      const badge = document.createElement("span");
      badge.className = signal.current ? "pdf-hl-badge pdf-hl-badge--current" : "pdf-hl-badge";
      badge.dataset.signalId = signal.id;
      badge.textContent = signal.label;
      badge.style.left = firstMark.style.left;
      badge.style.top = firstMark.style.top;
      badge.style.background = withAlpha(signal.color, signal.current ? 0.95 : 0.8);
      layer.appendChild(badge);
    }

    return drewOne;
  }

  function queueScrollToHighlight(
    layer: HTMLDivElement,
    prefer: "current" | null,
  ): void {
    requestAnimationFrame(() => {
      const target =
        (prefer === "current"
          ? (layer.querySelector(".pdf-hl--current") as HTMLElement | null)
          : null) ?? (layer.querySelector(".pdf-hl") as HTMLElement | null);
      if (target && viewerScrollEl) {
        const top = target.offsetTop - viewerScrollEl.clientHeight / 3;
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
    // Invalide tout rendu/chargement en vol. On NE détruit PLUS le doc : il
    // appartient désormais au cache module-level (#89c) et peut servir une
    // réouverture. Le détruire ici rendrait le doc caché inutilisable
    // (worker fermé) → crash à la prochaine ouverture du même rawRef. La
    // mémoire est bornée par l'éviction LRU du cache.
    renderToken++;
    loadToken++;
    resizeObserver?.disconnect();
    resizeObserver = null;
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
        <!-- #90 — pendant le chargement (ouverture OU switch de doc), le stage
             est masqué (visibility:hidden, garde sa place) pour ne PAS laisser
             le canvas de l'ANCIEN doc visible sous le waiter. Le scroller reste
             monté (mesures fit-width + ResizeObserver). -->
        <div class="pdf-canvas-stage" class:is-loading={loading}>
          <canvas bind:this={canvasEl}></canvas>
          <div class="pdf-text-layer" bind:this={textLayerEl} aria-hidden="true"></div>
        </div>
        {#if loading}
          <div class="pdf-loading" role="status" aria-live="polite">
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

  /* #90 — masqué pendant le chargement : on garde la place (pas de reflow), mais
     le canvas de l'ancien doc ne transparaît pas sous le waiter. */
  .pdf-canvas-stage.is-loading {
    visibility: hidden;
  }

  .pdf-text-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .pdf-text-layer :global(.pdf-hl) {
    position: absolute;
    /* La couleur (background/outline) est appliquée en inline par signal pour
       le multi-signaux (#84) — chaque signal a sa teinte. */
    mix-blend-mode: multiply;
    border-radius: 2px;
  }

  /* Le surlignage du signal COURANT passe au-dessus des autres. */
  .pdf-text-layer :global(.pdf-hl--current) {
    z-index: 2;
  }

  /* Badge ID en surimpression, ancré au coin haut-gauche du 1er rectangle du
     surlignage. Petit, lisible, non envahissant (#84). */
  .pdf-text-layer :global(.pdf-hl-badge) {
    position: absolute;
    z-index: 3;
    transform: translateY(-100%);
    padding: 0 0.28rem;
    border-radius: 3px;
    color: #fff;
    font-size: 0.62rem;
    font-weight: 700;
    line-height: 1.35;
    letter-spacing: 0.01em;
    white-space: nowrap;
    text-shadow: 0 1px 1px rgb(15 23 42 / 0.35);
    box-shadow: 0 1px 2px rgb(15 23 42 / 0.25);
    pointer-events: none;
  }

  .pdf-text-layer :global(.pdf-hl-badge--current) {
    z-index: 4;
    outline: 1px solid rgb(255 255 255 / 0.7);
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
    /* Fond OPAQUE plein-cadre (#90) : le waiter couvre franchement la zone, pas
       de doc résiduel visible derrière au switch. */
    background: var(--st-semantic-surface-sunken, #e2e8f0);
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
