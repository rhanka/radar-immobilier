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
    FileX,
    Loader2,
    Minus,
    Plus,
    RefreshCw,
    TriangleAlert,
    X,
  } from "@lucide/svelte";
  import {
    ChevronsLeft,
    ChevronsRight,
    EyeOff,
    Eye,
    Search,
  } from "@lucide/svelte";
  import { findCitationInPage } from "$lib/signals/pdf-citation-match.js";
  import type {
    OverlaySignal,
    OverlayNavSignal,
    HoverCardData,
  } from "$lib/signals/pdf-overlay-signals.js";
  import { distinctDocCount } from "$lib/signals/pdf-overlay-signals.js";

  export let title = "Document source";
  export let sourceUrl: string | null = null;
  export let sourceRef: string | null = null;
  export let rawRef: string | null = null;
  export let rawObjectKey: string | null = null;
  export let documentDate: string | null = null;
  export let page: number | null = null;
  export let bbox: [number, number, number, number] | null = null;
  /**
   * Filet Radar : `true` quand ce PV a été rattaché AUTOMATIQUEMENT
   * (`linkSource === "radar-auto-link"`), à distinguer d'une citation graphify
   * vérifiée. Affiche une mention DISCRÈTE « lien automatique » près du titre.
   * Absent/`false` → aucune mention (lien vérifié).
   */
  export let provisional = false;
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
  /**
   * #91 — NAVIGATION PAR SIGNAL. `navSignals` est la liste FILTRÉE COMPLÈTE du
   * parent (ordre du pane droit), potentiellement MULTI-DOC : c'est la source de
   * vérité de la nav (◀ Signal ▶, compteur i/N, menu « aller à »). Le viewer NE
   * refiltre PAS ; il consomme cette liste + `navIndex` (rang courant, 0-based)
   * et notifie le parent via `onNavigate`. Vide ⇒ rangée nav masquée (LOT 1/2).
   */
  export let navSignals: OverlayNavSignal[] = [];
  /** Rang courant (0-based) dans `navSignals`. -1 si non résolu. */
  export let navIndex = -1;
  /**
   * Demande de navigation : le viewer délègue au PARENT le recalcul de
   * l'évidence/des signaux/du document (le parent réassigne rawRef/page → le
   * bloc réactif déclenche loadPdf si c'est un autre doc, #89/#90). Idempotent.
   */
  export let onNavigate: (index: number) => void = () => {};
  export let onClose: () => void = () => {};

  // ── Navigation par signal (#91) ─────────────────────────────────────────────
  // Index courant borné à la liste. Si le parent fournit -1 (pas encore résolu),
  // on retombe sur le signal marqué `current` dans `signals` (rétrocompat) ou 0.
  $: navCount = navSignals.length;
  $: effectiveNavIndex = (() => {
    if (navCount === 0) return -1;
    if (navIndex >= 0 && navIndex < navCount) return navIndex;
    // Repli : retrouve le navSignal correspondant au signal courant surligné.
    const currentSig = signals.find((s) => s.current);
    if (currentSig) {
      const i = navSignals.findIndex((n) => n.id === currentSig.id);
      if (i >= 0) return i;
    }
    return 0;
  })();
  $: hasNav = navCount > 0 && effectiveNavIndex >= 0;
  $: currentNavSignal =
    hasNav ? (navSignals[effectiveNavIndex] ?? null) : null;
  // Indicateur PDF i/N : visible seulement si la nav couvre ≥ 2 documents.
  $: navDocCount = distinctDocCount(navSignals);
  $: isMultiDoc = navDocCount >= 2;
  // Rang du DOCUMENT courant (1-based) parmi les docs distincts, dans l'ordre.
  $: navDocOrder = (() => {
    const order: string[] = [];
    for (const n of navSignals) if (n.docId && !order.includes(n.docId)) order.push(n.docId);
    return order;
  })();
  $: currentDocRank =
    currentNavSignal && currentNavSignal.docId
      ? navDocOrder.indexOf(currentNavSignal.docId) + 1
      : 0;

  /** Va au signal de rang `i` (borné, pas de wrap circulaire). */
  function goToNavSignal(i: number): void {
    if (i < 0 || i >= navCount) return;
    if (i === effectiveNavIndex) return;
    closeNavMenu();
    onNavigate(i);
  }
  function navPrevSignal(): void {
    if (effectiveNavIndex > 0) goToNavSignal(effectiveNavIndex - 1);
  }
  function navNextSignal(): void {
    if (effectiveNavIndex >= 0 && effectiveNavIndex < navCount - 1)
      goToNavSignal(effectiveNavIndex + 1);
  }

  // ── Menu déroulant « aller à » (#91 scalabilité) ────────────────────────────
  let navMenuOpen = false;
  let navMenuQuery = "";
  function toggleNavMenu(): void {
    navMenuOpen = !navMenuOpen;
    if (navMenuOpen) navMenuQuery = "";
  }
  function closeNavMenu(): void {
    navMenuOpen = false;
  }
  /** Items du menu, groupés par document, filtrés par la recherche texte. */
  $: navMenuGroups = (() => {
    const q = navMenuQuery.trim().toLowerCase();
    const groups = new Map<
      string,
      { docId: string; docTitle: string; items: { index: number; sig: OverlayNavSignal }[] }
    >();
    navSignals.forEach((sig, index) => {
      if (
        q.length > 0 &&
        !`${sig.label} ${sig.docTitle} ${sig.page ?? ""}`.toLowerCase().includes(q)
      )
        return;
      const docId = sig.docId || "(sans document)";
      if (!groups.has(docId))
        groups.set(docId, { docId, docTitle: sig.docTitle || "Document", items: [] });
      groups.get(docId)!.items.push({ index, sig });
    });
    return Array.from(groups.values());
  })();

  // ── Toggle « masquer hors-filtre » (#4) ─────────────────────────────────────
  // Par défaut les hors-filtre du doc sont VISIBLES (slate désaturé). Le toggle
  // les masque. L'état est relayé au surlignage via `signals` côté parent ; ici
  // on expose juste l'intention pour que le viewer la propage au rendu.
  export let hideOutOfFilter = false;
  export let onToggleHideOutOfFilter: (hide: boolean) => void = () => {};
  function toggleHideOutOfFilter(): void {
    hideOutOfFilter = !hideOutOfFilter;
    onToggleHideOutOfFilter(hideOutOfFilter);
  }

  // ── #86 — Cross-highlight signal ↔ fiche (PAS de flèche SVG) ─────────────────
  /**
   * Sens VIEWER → FICHE : hover/focus d'un badge/surlignage PDF notifie le parent
   * (qui sélectionne + scrolle la fiche correspondante à droite).
   */
  export let onSignalHover: (id: string | null) => void = () => {};
  /**
   * Sens FICHE → VIEWER : id du signal survolé à DROITE. Le surlignage
   * correspondant dans le PDF PULSE (outline animé) ; s'il est hors page
   * courante, un mini-toast d'ancrage « Signal X — page N ↘ » s'affiche (clic =
   * y aller). null = aucun hover externe.
   */
  export let hoveredSignalId: string | null = null;

  // Applique/retire la classe de pulse sur les marques du signal survolé à
  // droite, et calcule le toast d'ancrage si le signal est sur une autre page.
  $: applyExternalHover(hoveredSignalId);
  $: externalHoverToast = (() => {
    if (!hoveredSignalId) return null;
    const sig = effectiveSignals.find((s) => s.id === hoveredSignalId);
    if (!sig || sig.page === null || sig.page === currentPage) return null;
    return { label: sig.label || "Signal", page: sig.page, color: sig.color };
  })();

  function applyExternalHover(id: string | null): void {
    if (typeof document === "undefined" || !textLayerEl) return;
    // Retire toute pulsation précédente puis (ré)applique sur le signal courant.
    for (const el of textLayerEl.querySelectorAll(".pdf-hl--pulse")) {
      el.classList.remove("pdf-hl--pulse");
    }
    if (!id) return;
    for (const el of textLayerEl.querySelectorAll<HTMLElement>(
      `.pdf-hl[data-signal-id="${cssAttrEscape(id)}"]`,
    )) {
      el.classList.add("pdf-hl--pulse");
    }
  }

  /** Va à la page d'un signal (clic sur le toast d'ancrage #86). */
  function goToSignalPage(targetPage: number): void {
    if (pdfDoc && targetPage >= 1 && targetPage <= numPages) {
      void renderPage(targetPage);
    }
  }

  /** Échappe une valeur pour un sélecteur d'attribut CSS (id arbitraire). */
  function cssAttrEscape(value: string): string {
    return value.replace(/["\\]/g, "\\$&");
  }

  // ── #4 — Hover-card des signaux HORS-FILTRE ─────────────────────────────────
  /**
   * Résout les données de la hover-card pour un signal (le parent projette le
   * nœud, le viewer ne connaît pas la forme du DTO). null ⇒ pas de carte.
   */
  export let resolveHoverCard: (id: string) => HoverCardData | null = () => null;
  /** Actions de la hover-card (footer). */
  export let onMakeCurrent: (id: string) => void = () => {};
  export let onAddToFilter: (id: string) => void = () => {};

  let hoverCard: HoverCardData | null = null;
  let hoverCardAnchor: { x: number; y: number; flipUp: boolean } | null = null;
  let hoverCardHovered = false; // souris sur la carte elle-même (safe-triangle)
  let hoverCardCloseTimer: ReturnType<typeof setTimeout> | null = null;

  /** Ouvre la hover-card pour un signal hors-filtre, ancrée sur son badge. */
  function openHoverCard(id: string, badge: HTMLElement): void {
    const data = resolveHoverCard(id);
    if (!data) return;
    if (hoverCardCloseTimer) {
      clearTimeout(hoverCardCloseTimer);
      hoverCardCloseTimer = null;
    }
    const rect = badge.getBoundingClientRect();
    const overlayRect =
      viewerScrollEl?.closest(".pdf-overlay")?.getBoundingClientRect() ?? null;
    const baseX = overlayRect ? rect.left - overlayRect.left : rect.left;
    const baseY = overlayRect ? rect.top - overlayRect.top : rect.top;
    // Flip vertical auto : si trop bas dans l'overlay, ouvre vers le HAUT.
    const flipUp = overlayRect ? baseY > overlayRect.height * 0.55 : false;
    hoverCard = data;
    hoverCardAnchor = { x: baseX, y: baseY, flipUp };
  }

  /** Programme la fermeture (laisse le temps de glisser vers la carte). */
  function scheduleHoverCardClose(): void {
    if (hoverCardCloseTimer) clearTimeout(hoverCardCloseTimer);
    hoverCardCloseTimer = setTimeout(() => {
      if (!hoverCardHovered) {
        hoverCard = null;
        hoverCardAnchor = null;
      }
    }, 160);
  }
  function closeHoverCardNow(): void {
    if (hoverCardCloseTimer) clearTimeout(hoverCardCloseTimer);
    hoverCardCloseTimer = null;
    hoverCardHovered = false;
    hoverCard = null;
    hoverCardAnchor = null;
  }

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
        // #4 — quand `hideOutOfFilter` est actif, on EXCLUT les signaux
        // hors-filtre du rendu (ils ne sont ni surlignés ni badgés).
        const targets = effectiveSignals.filter(
          (s) =>
            currentPage === (s.page ?? currentPage) &&
            s.excerpt !== null &&
            s.excerpt.trim().length > 0 &&
            (!hideOutOfFilter || s.inFilter !== false),
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
      // #86 — réapplique la pulsation du hover externe après recréation des marques.
      applyExternalHover(hoveredSignalId);
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

  // Teinte SLATE désaturée pour les signaux HORS-FILTRE (#4) : présents mais
  // visuellement en retrait, distincts des dans-filtre colorés.
  const OUT_OF_FILTER_COLOR = "#64748b"; // slate-500

  /** Teinte un surlignage : couleur pleine pour le courant, estompé sinon. */
  function applyHighlightColor(
    mark: HTMLElement,
    color: string,
    current: boolean,
    inFilter = true,
  ): void {
    if (!inFilter) {
      // HORS-FILTRE : slate désaturé + bordure TIRETÉE (le viewer signale qu'il
      // est sur le PV mais pas dans le filtre actif). Pas de mise en avant.
      mark.style.setProperty("--hl-color", OUT_OF_FILTER_COLOR);
      mark.style.background = withAlpha(OUT_OF_FILTER_COLOR, 0.16);
      mark.style.outline = `1px dashed ${withAlpha(OUT_OF_FILTER_COLOR, 0.7)}`;
      return;
    }
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
      const inFilter = signal.inFilter !== false;
      const mark = document.createElement("div");
      mark.className = signal.current
        ? "pdf-hl pdf-hl--current"
        : inFilter
          ? "pdf-hl"
          : "pdf-hl pdf-hl--out";
      mark.dataset.signalId = signal.id;
      mark.style.left = `${tx}px`;
      mark.style.top = `${ty - fontHeight}px`;
      mark.style.width = `${width}px`;
      mark.style.height = `${fontHeight * 1.15}px`;
      applyHighlightColor(mark, signal.color, signal.current, inFilter);
      layer.appendChild(mark);
      if (!firstMark) firstMark = mark;
      drewOne = true;
    }

    // Badge ID en surimpression, ancré au coin haut-gauche du 1er rectangle.
    // Affiché seulement quand un libellé est fourni (mode multi #84) — en mode
    // mono LOT 1 le libellé est vide, on n'ajoute pas de badge (non-régression).
    if (drewOne && firstMark && signal.label.trim().length > 0) {
      const inFilter = signal.inFilter !== false;
      const badge = document.createElement("span");
      // #4 — badge PLEIN pour les dans-filtre (couleur signal), badge CREUX
      // (contour, fond transparent) pour les hors-filtre slate.
      badge.className = signal.current
        ? "pdf-hl-badge pdf-hl-badge--current"
        : inFilter
          ? "pdf-hl-badge"
          : "pdf-hl-badge pdf-hl-badge--out";
      badge.dataset.signalId = signal.id;
      badge.textContent = signal.label;
      badge.style.left = firstMark.style.left;
      badge.style.top = firstMark.style.top;
      // Hover/focus du badge. pointer-events réactivé (la couche est inerte).
      badge.style.pointerEvents = "auto";
      badge.tabIndex = 0;
      badge.setAttribute("role", "button");
      badge.setAttribute("aria-label", `Signal ${signal.label}`);
      const sigId = signal.id;
      const enter = (ev: Event) => {
        if (inFilter) {
          // #86 — dans-filtre : notifie le parent (fiche droite se sélectionne).
          onSignalHover(sigId);
        } else {
          // #4 — hors-filtre : ouvre la hover-card miroir, ancrée sur le badge.
          openHoverCard(sigId, ev.currentTarget as HTMLElement);
        }
      };
      const leave = () => {
        if (inFilter) onSignalHover(null);
        else scheduleHoverCardClose();
      };
      badge.addEventListener("mouseenter", enter);
      badge.addEventListener("mouseleave", leave);
      badge.addEventListener("focus", enter);
      badge.addEventListener("blur", leave);
      if (inFilter) {
        badge.style.background = withAlpha(signal.color, signal.current ? 0.95 : 0.8);
      } else {
        // Badge creux : fond clair, texte + contour slate.
        badge.style.background = "rgba(255, 255, 255, 0.9)";
        badge.style.color = OUT_OF_FILTER_COLOR;
        badge.style.border = `1px dashed ${OUT_OF_FILTER_COLOR}`;
      }
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

  /**
   * #94 — RÉESSAYER après une erreur de chargement (cas b : doc attendu mais
   * fetch/render KO). `loadedUrl` vaut déjà l'URL fautive, donc le bloc réactif
   * de chargement ne reboucle pas tout seul : on relance loadPdf directement.
   * L'entrée fautive a déjà été retirée du docCache (catch getCachedDocument),
   * donc un retry refait un vrai fetch (utile pour un 404/réseau transitoire).
   */
  function retryLoad(): void {
    if (!resolvedSourceUrl) return;
    void loadPdf(resolvedSourceUrl);
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
    if (event.key === "Escape") {
      if (hoverCard) {
        closeHoverCardNow();
        return;
      }
      if (navMenuOpen) {
        closeNavMenu();
        return;
      }
      onClose();
    } else if (hasNav && (event.key === "PageUp" || event.altKey && event.key === "ArrowLeft")) {
      event.preventDefault();
      navPrevSignal();
    } else if (hasNav && (event.key === "PageDown" || event.altKey && event.key === "ArrowRight")) {
      event.preventDefault();
      navNextSignal();
    } else if (event.key === "ArrowLeft") goPrev();
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

  // #4 — re-rend la page courante quand le toggle « masquer hors-filtre »
  // bascule (les surlignages hors-filtre apparaissent/disparaissent). On ne
  // touche pas au scroll : même page, même échelle, juste le set de marques.
  let lastHideOutOfFilter = hideOutOfFilter;
  $: if (hideOutOfFilter !== lastHideOutOfFilter) {
    lastHideOutOfFilter = hideOutOfFilter;
    if (pdfDoc) void renderPage(currentPage);
  }

  // #91 — navigation INTRA-PDF pilotée par le parent : quand la prop `page`
  // change SANS recharger le doc (même rawRef, autre signal sur une autre page),
  // on va à cette page + recentre le surlignage du nouveau signal courant. Sans
  // ça le compteur avancerait mais le PDF resterait figé. On ignore le 1er
  // passage (déjà géré par loadPdf) et les changements vers la page déjà rendue.
  let lastPageProp = page;
  $: if (page !== lastPageProp) {
    lastPageProp = page;
    if (pdfDoc && page && page >= 1 && page <= numPages && page !== currentPage) {
      void renderPage(page);
    }
  }

  // #91 — navigation vers un signal sur la MÊME page (ex. A16 → Rf51 page 2) :
  // `page` ne change pas, mais le signal COURANT (signals[].current) change. On
  // re-rend pour mettre à jour la mise en avant + recentrer sur le nouveau
  // courant. Clé = id du signal marqué courant.
  $: currentSignalId = effectiveSignals.find((s) => s.current)?.id ?? null;
  let lastCurrentSignalId = currentSignalId;
  $: if (currentSignalId !== lastCurrentSignalId) {
    lastCurrentSignalId = currentSignalId;
    // Ne re-rend que si la page ne va PAS changer (sinon double rendu) : le bloc
    // `page` ci-dessus s'en charge quand la page diffère.
    if (pdfDoc && (!page || page === currentPage)) {
      void renderPage(currentPage);
    }
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
    <div class="pdf-overlay-head-row">
      <div class="pdf-overlay-title-block">
        <span class="pdf-overlay-kicker">Preuve</span>
        <h2 class="pdf-overlay-title">{title}</h2>
        <div class="pdf-overlay-meta">
          <span>Date : {documentDate ?? "non disponible"}</span>
          {#if provisional}
            <!-- Filet Radar : mention DISCRÈTE d'un PV auto-lié (à confirmer). -->
            <span
              class="pdf-overlay-autolink"
              title="PV rattaché automatiquement par Radar (à confirmer) — distinct d'une citation vérifiée."
              aria-label="Source liée automatiquement par le filet Radar, à confirmer"
            >
              Lien automatique
            </span>
          {/if}
        </div>
      </div>

      <div class="pdf-overlay-actions" aria-label="Actions globales">
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
    </div>

    <!-- Rangée contrôle : parcours signal → document/page → zoom → filtre. -->
    <div class="pdf-overlay-nav" role="group" aria-label="Contrôles de navigation du document">
      {#if hasNav && currentNavSignal}
        <div class="pdf-nav-signal" aria-label="Navigation par signal">
          <button
            type="button"
            class="pdf-pager-btn pdf-nav-signal-btn"
            on:click={navPrevSignal}
            disabled={effectiveNavIndex <= 0}
            aria-label="Signal précédent"
            title="Signal précédent (Page préc.)"
          >
            <ChevronsLeft class="h-4 w-4" aria-hidden="true" />
          </button>

          <button
            type="button"
            class="pdf-nav-counter"
            on:click={toggleNavMenu}
            aria-haspopup="listbox"
            aria-expanded={navMenuOpen}
            aria-label="Aller à un signal — actuellement {effectiveNavIndex + 1} sur {navCount}"
            title="Cliquer pour aller à un signal"
          >
            <span
              class="pdf-nav-dot"
              style="background:{currentNavSignal.color}"
              aria-hidden="true"
            ></span>
            <span class="pdf-nav-counter-label">Signal</span>
            <strong class="pdf-nav-counter-pos">
              {effectiveNavIndex + 1}<span class="pdf-nav-counter-sep">/</span>{navCount}
            </strong>
          </button>

          <button
            type="button"
            class="pdf-pager-btn pdf-nav-signal-btn"
            on:click={navNextSignal}
            disabled={effectiveNavIndex >= navCount - 1}
            aria-label="Signal suivant"
            title="Signal suivant (Page suiv.)"
          >
            <ChevronsRight class="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      {/if}

      {#if isMultiDoc}
        <span class="pdf-nav-pdfcount" title="Document {currentDocRank} sur {navDocCount}">
          PDF {currentDocRank}/{navDocCount}
        </span>
      {/if}

      <div class="pdf-pager pdf-page-group" role="group" aria-label="Navigation des pages">
        {#if pdfDoc && numPages > 1}
          <button
            type="button"
            class="pdf-pager-btn"
            on:click={goPrev}
            disabled={currentPage <= 1}
            aria-label="Page précédente"
          >
            <ChevronLeft class="h-4 w-4" aria-hidden="true" />
          </button>
        {/if}
        <span class="pdf-page-indicator">
          {#if pdfDoc && numPages > 0}
            Page {currentPage}/{numPages}
          {:else if page}
            Page {page}
          {:else}
            Page —
          {/if}
        </span>
        {#if pdfDoc && numPages > 1}
          <button
            type="button"
            class="pdf-pager-btn"
            on:click={goNext}
            disabled={currentPage >= numPages}
            aria-label="Page suivante"
          >
            <ChevronRight class="h-4 w-4" aria-hidden="true" />
          </button>
        {/if}
      </div>

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

      <span class="pdf-nav-spacer"></span>

      {#if hasNav && currentNavSignal}
        <button
          type="button"
          class="pdf-nav-toggle"
          class:pdf-nav-toggle--on={hideOutOfFilter}
          on:click={toggleHideOutOfFilter}
          aria-pressed={hideOutOfFilter}
          title={hideOutOfFilter
            ? "Afficher les signaux hors-filtre du document"
            : "Masquer les signaux hors-filtre du document"}
        >
          {#if hideOutOfFilter}
            <EyeOff class="h-3.5 w-3.5" aria-hidden="true" />
          {:else}
            <Eye class="h-3.5 w-3.5" aria-hidden="true" />
          {/if}
          <span>Hors-filtre</span>
        </button>
      {/if}
    </div>

      {#if navMenuOpen}
        <!-- Menu déroulant « aller à » : scrollable, GROUPÉ PAR DOCUMENT,
             recherche texte. Item = pastille + label + page. Courant surligné. -->
        <div class="pdf-nav-menu" role="listbox" aria-label="Liste des signaux filtrés">
          <div class="pdf-nav-menu-search">
            <Search class="h-3.5 w-3.5" aria-hidden="true" />
            <input
              type="text"
              class="pdf-nav-menu-input"
              placeholder="Rechercher un signal…"
              bind:value={navMenuQuery}
              aria-label="Rechercher un signal dans la liste"
            />
          </div>
          <div class="pdf-nav-menu-scroll">
            {#each navMenuGroups as group (group.docId)}
              <div class="pdf-nav-menu-group">
                {#if isMultiDoc}
                  <div class="pdf-nav-menu-group-head" title={group.docTitle}>
                    {group.docTitle}
                  </div>
                {/if}
                {#each group.items as { index, sig } (sig.id)}
                  <button
                    type="button"
                    class="pdf-nav-menu-item"
                    class:pdf-nav-menu-item--current={index === effectiveNavIndex}
                    role="option"
                    aria-selected={index === effectiveNavIndex}
                    on:click={() => goToNavSignal(index)}
                  >
                    <span
                      class="pdf-nav-dot"
                      style="background:{sig.color}"
                      aria-hidden="true"
                    ></span>
                    <span class="pdf-nav-menu-item-label">{sig.label}</span>
                    {#if sig.page !== null}
                      <span class="pdf-nav-menu-item-page">p.{sig.page}</span>
                    {/if}
                  </button>
                {/each}
              </div>
            {:else}
              <p class="pdf-nav-menu-empty">Aucun signal ne correspond.</p>
            {/each}
          </div>
        </div>
      {/if}
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

        {#if externalHoverToast}
          <!-- #86 — mini-toast d'ancrage : le signal survolé à droite est sur
               une AUTRE page. Clic = y aller. Pas de flèche SVG : un libellé. -->
          <button
            type="button"
            class="pdf-anchor-toast"
            on:click={() => goToSignalPage(externalHoverToast.page)}
            title="Aller à la page {externalHoverToast.page}"
          >
            <span
              class="pdf-nav-dot"
              style="background:{externalHoverToast.color}"
              aria-hidden="true"
            ></span>
            <span>{externalHoverToast.label} — page {externalHoverToast.page} ↘</span>
          </button>
        {/if}
      </div>
    {:else if resolvedSourceUrl && !loadError}
      <!-- Source non-PDF (HTML…) : aperçu direct en iframe, sans éditeur. -->
      <iframe class="pdf-frame" title={title} src={resolvedSourceUrl}></iframe>
    {:else if loadError}
      <!-- #94 cas (b) — PROBLÈME TEMPORAIRE : un document est attendu (rawRef /
           sourceRef présent) mais le fetch/render a échoué. On le dit clairement,
           on propose RÉESSAYER (refait un vrai fetch) et le lien externe si dispo.
           Distinct du cas (a) « aucune source » géré plus bas. -->
      <div class="pdf-missing" role="alert">
        <TriangleAlert class="pdf-missing-icon" aria-hidden="true" />
        <p class="pdf-missing-title">Problème temporaire de chargement</p>
        <p class="pdf-missing-detail">
          Le document source est attendu mais n'a pas pu être chargé. Cela peut être
          passager (réseau, source momentanément indisponible).
        </p>
        <div class="pdf-missing-actions">
          <button type="button" class="pdf-missing-retry" on:click={retryLoad}>
            <RefreshCw class="h-3.5 w-3.5" aria-hidden="true" />
            Réessayer
          </button>
          {#if sourceUrl}
            <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
              Ouvrir le document <ExternalLink class="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          {/if}
        </div>
        {#if fallbackRef}
          <code>{fallbackRef}</code>
        {/if}
      </div>
    {:else}
      <!-- #94 cas (a) — preuve NON DISPONIBLE : aucune source documentaire n'est
           reliée à ce signal (ni rawRef, ni sourceUrl, ni route de streaming).
           Message explicite plutôt qu'un cadre vide ou un bouton mort. -->
      <div class="pdf-missing" role="note">
        <FileX class="pdf-missing-icon" aria-hidden="true" />
        <p class="pdf-missing-title">Preuve non disponible</p>
        <p class="pdf-missing-detail">
          Aucune source documentaire n'est reliée à ce signal pour l'instant.
        </p>
        {#if fallbackRef}
          <code>{fallbackRef}</code>
        {/if}
      </div>
    {/if}
  </div>

  {#if hoverCard && hoverCardAnchor}
    <!-- #4 — HOVER-CARD non-modale d'un signal HORS-FILTRE : miroir de la fiche
         droite. role=dialog, Escape ferme, accessible clavier, flip auto. -->
    <div
      class="pdf-hovercard"
      class:pdf-hovercard--up={hoverCardAnchor.flipUp}
      role="dialog"
      tabindex="-1"
      aria-label="Aperçu du signal {hoverCard.title}"
      style="left:{hoverCardAnchor.x}px; {hoverCardAnchor.flipUp
        ? `bottom:calc(100% - ${hoverCardAnchor.y}px + 0.4rem)`
        : `top:calc(${hoverCardAnchor.y}px + 1.2rem)`}"
      on:mouseenter={() => {
        hoverCardHovered = true;
      }}
      on:mouseleave={() => {
        hoverCardHovered = false;
        scheduleHoverCardClose();
      }}
    >
      <div class="pdf-hovercard-head">
        <span
          class="pdf-nav-dot"
          style="background:{hoverCard.color}"
          aria-hidden="true"
        ></span>
        <strong class="pdf-hovercard-title">{hoverCard.title}</strong>
        <span class="pdf-hovercard-type">{hoverCard.typeLabel}</span>
      </div>

      <div class="pdf-hovercard-meta">
        {#if hoverCard.reglement}
          <span class="pdf-hovercard-key">Règlement</span>
          <code class="pdf-hovercard-val">{hoverCard.reglement}</code>
        {/if}
        {#if hoverCard.zoneRef}
          <span class="pdf-hovercard-key">Zone</span>
          <code class="pdf-hovercard-val">{hoverCard.zoneRef}</code>
        {/if}
        {#if hoverCard.documentDate}
          <span class="pdf-hovercard-key">Date doc.</span>
          <span class="pdf-hovercard-val">{hoverCard.documentDate}</span>
        {/if}
        {#if hoverCard.page !== null}
          <span class="pdf-hovercard-key">Page</span>
          <span class="pdf-hovercard-val">{hoverCard.page}</span>
        {/if}
      </div>

      {#if hoverCard.citation}
        <blockquote class="pdf-hovercard-citation">{hoverCard.citation}</blockquote>
      {/if}

      <div class="pdf-hovercard-chips">
        {#each hoverCard.completeness as chip (chip.label)}
          <span
            class="pdf-hovercard-chip"
            class:pdf-hovercard-chip--ok={chip.ok}
            class:pdf-hovercard-chip--missing={!chip.ok}
          >
            {chip.label}
          </span>
        {/each}
      </div>

      <div class="pdf-hovercard-footer">
        <button
          type="button"
          class="pdf-hovercard-action pdf-hovercard-action--primary"
          on:click={() => {
            const id = hoverCard?.id;
            closeHoverCardNow();
            if (id) onMakeCurrent(id);
          }}
        >
          Voir comme courant
        </button>
        <button
          type="button"
          class="pdf-hovercard-action"
          on:click={() => {
            const id = hoverCard?.id;
            if (id) onAddToFilter(id);
          }}
        >
          Ajouter au filtre
        </button>
      </div>
    </div>
  {/if}
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
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.7rem 0.85rem;
    border-bottom: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
    background: var(--st-semantic-surface-subtle, #f8fafc);
  }

  .pdf-overlay-head-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
  }

  /* ── Rangée de navigation par signal (#91) ─────────────────────────────── */
  .pdf-overlay-nav {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding-top: 0.15rem;
    border-top: 1px dashed var(--st-semantic-border-subtle, #e2e8f0);
  }

  .pdf-nav-signal {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }

  .pdf-nav-signal-btn {
    /* nav-signal est PRIMAIRE : teinte d'accent plus marquée que la nav-page. */
    border-color: var(--st-semantic-border-strong, #94a3b8);
    color: var(--st-semantic-text-primary, #0f172a);
  }

  .pdf-nav-counter {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    height: 1.9rem;
    padding: 0 0.6rem;
    border: 1px solid var(--st-semantic-border-strong, #94a3b8);
    border-radius: var(--st-radius-sm, 4px);
    background: var(--st-semantic-surface-default, #fff);
    color: var(--st-semantic-text-primary, #0f172a);
    font-size: 0.76rem;
    cursor: pointer;
  }

  .pdf-nav-counter:hover {
    background: var(--st-semantic-surface-hover, #f1f5f9);
  }

  .pdf-nav-dot {
    width: 0.65rem;
    height: 0.65rem;
    border-radius: 9999px;
    box-shadow: 0 0 0 1px rgb(15 23 42 / 0.15);
    flex-shrink: 0;
  }

  .pdf-nav-counter-label {
    color: var(--st-semantic-text-muted, #64748b);
    font-weight: 600;
  }

  .pdf-nav-counter-pos {
    font-variant-numeric: tabular-nums;
    font-weight: 700;
  }

  .pdf-nav-counter-sep {
    margin: 0 0.1rem;
    color: var(--st-semantic-text-muted, #94a3b8);
    font-weight: 500;
  }

  .pdf-nav-pdfcount {
    display: inline-flex;
    align-items: center;
    height: 1.6rem;
    padding: 0 0.5rem;
    border: 1px solid var(--st-semantic-border-subtle, #cbd5e1);
    border-radius: 9999px;
    background: var(--st-semantic-surface-default, #fff);
    color: var(--st-semantic-text-secondary, #475569);
    font-size: 0.68rem;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
  }

  .pdf-nav-spacer {
    flex: 1;
  }

  .pdf-nav-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    height: 1.7rem;
    padding: 0 0.55rem;
    border: 1px solid var(--st-semantic-border-subtle, #cbd5e1);
    border-radius: var(--st-radius-sm, 4px);
    background: var(--st-semantic-surface-default, #fff);
    color: var(--st-semantic-text-secondary, #475569);
    font-size: 0.7rem;
    font-weight: 600;
    cursor: pointer;
  }

  .pdf-nav-toggle:hover {
    background: var(--st-semantic-surface-hover, #f1f5f9);
  }

  .pdf-nav-toggle--on {
    border-color: var(--st-semantic-border-strong, #94a3b8);
    color: var(--st-semantic-text-primary, #0f172a);
    background: var(--st-semantic-surface-hover, #f1f5f9);
  }

  /* ── Menu déroulant « aller à » (#91 scalabilité) ──────────────────────── */
  .pdf-nav-menu {
    position: absolute;
    top: calc(100% - 0.4rem);
    left: 0.85rem;
    z-index: 50;
    display: flex;
    flex-direction: column;
    width: min(22rem, calc(100% - 1.7rem));
    max-height: 22rem;
    overflow: hidden;
    border: 1px solid var(--st-semantic-border-subtle, #cbd5e1);
    border-radius: var(--st-radius-md, 6px);
    background: var(--st-semantic-surface-default, #fff);
    box-shadow: 0 12px 32px rgb(15 23 42 / 0.22);
  }

  .pdf-nav-menu-search {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.45rem 0.6rem;
    border-bottom: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
    color: var(--st-semantic-text-muted, #64748b);
  }

  .pdf-nav-menu-input {
    flex: 1;
    border: 0;
    background: transparent;
    color: var(--st-semantic-text-primary, #0f172a);
    font-size: 0.78rem;
    outline: none;
  }

  .pdf-nav-menu-scroll {
    overflow-y: auto;
    padding: 0.25rem;
  }

  .pdf-nav-menu-group-head {
    padding: 0.3rem 0.5rem 0.15rem;
    color: var(--st-semantic-text-muted, #64748b);
    font-size: 0.66rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pdf-nav-menu-item {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    width: 100%;
    padding: 0.35rem 0.5rem;
    border: 0;
    border-radius: var(--st-radius-sm, 4px);
    background: transparent;
    color: var(--st-semantic-text-primary, #0f172a);
    font-size: 0.78rem;
    text-align: left;
    cursor: pointer;
  }

  .pdf-nav-menu-item:hover {
    background: var(--st-semantic-surface-hover, #f1f5f9);
  }

  .pdf-nav-menu-item--current {
    background: var(--st-semantic-surface-selected, #e0f2fe);
    font-weight: 650;
  }

  .pdf-nav-menu-item-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pdf-nav-menu-item-page {
    color: var(--st-semantic-text-muted, #64748b);
    font-size: 0.7rem;
    font-variant-numeric: tabular-nums;
  }

  .pdf-nav-menu-empty {
    margin: 0;
    padding: 0.6rem;
    color: var(--st-semantic-text-muted, #64748b);
    font-size: 0.76rem;
    text-align: center;
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

  /* Filet Radar : mention DISCRÈTE « lien automatique » — pastille info/neutre
     en tokens DS, jamais warning. */
  .pdf-overlay-autolink {
    display: inline-flex;
    align-items: center;
    padding: 0 0.4rem;
    border-radius: var(--st-radius-pill, 999px);
    background: var(--st-semantic-feedback-info-surface, #eff6ff);
    color: var(--st-semantic-feedback-info, #1d4ed8);
    font-weight: 650;
    cursor: help;
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

  .pdf-page-group {
    padding: 0.15rem;
    border: 1px solid var(--st-semantic-border-subtle, #cbd5e1);
    border-radius: var(--st-radius-md, 6px);
    background: var(--st-semantic-surface-default, #fff);
  }

  .pdf-page-indicator {
    min-width: 5.6rem;
    color: var(--st-semantic-text-secondary, #475569);
    font-size: 0.74rem;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
    text-align: center;
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

  /* #4 — surlignage HORS-FILTRE : slate désaturé, passe SOUS les dans-filtre. */
  .pdf-text-layer :global(.pdf-hl--out) {
    z-index: 0;
    mix-blend-mode: normal;
  }

  /* Badge CREUX hors-filtre : pas d'ombre portée, contour discret. */
  .pdf-text-layer :global(.pdf-hl-badge--out) {
    z-index: 1;
    box-shadow: none;
    text-shadow: none;
  }

  /* #86 — pulsation du surlignage quand la fiche correspondante est survolée à
     droite : outline animé (pas de flèche). Passe au-dessus pour être vu. */
  .pdf-text-layer :global(.pdf-hl--pulse) {
    z-index: 5;
    animation: pdf-hl-pulse 1.1s ease-in-out infinite;
  }

  @keyframes pdf-hl-pulse {
    0%,
    100% {
      outline: 2px solid rgb(15 23 42 / 0.35);
      outline-offset: 0;
    }
    50% {
      outline: 2px solid rgb(15 23 42 / 0.85);
      outline-offset: 2px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .pdf-text-layer :global(.pdf-hl--pulse) {
      animation: none;
      outline: 2px solid rgb(15 23 42 / 0.7);
    }
  }

  /* #86 — mini-toast d'ancrage (signal survolé sur une autre page). */
  .pdf-anchor-toast {
    position: absolute;
    right: 0.85rem;
    bottom: 0.85rem;
    z-index: 12;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem 0.65rem;
    border: 1px solid var(--st-semantic-border-strong, #94a3b8);
    border-radius: 9999px;
    background: var(--st-semantic-surface-default, #fff);
    color: var(--st-semantic-text-primary, #0f172a);
    font-size: 0.74rem;
    font-weight: 650;
    box-shadow: 0 6px 18px rgb(15 23 42 / 0.22);
    cursor: pointer;
  }

  .pdf-anchor-toast:hover {
    background: var(--st-semantic-surface-hover, #f1f5f9);
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
    justify-items: center;
    gap: 0.5rem;
    padding: 1.25rem;
    max-width: 26rem;
    margin: 0 auto;
    color: var(--st-semantic-text-secondary, #475569);
    text-align: center;
  }

  /* #94 — icône d'état (fichier barré = absence ; triangle = problème temporaire).
     :global car la classe est posée sur un composant Lucide (SVG enfant), pas un
     élément DOM direct → Svelte ne la scoperait pas sinon (selector "unused"). */
  .pdf-missing :global(.pdf-missing-icon) {
    width: 2rem;
    height: 2rem;
    color: var(--st-semantic-text-muted, #94a3b8);
  }

  .pdf-missing-title {
    margin: 0;
    color: var(--st-semantic-text-primary, #1e293b);
    font-size: 0.92rem;
    font-weight: 650;
  }

  .pdf-missing-detail {
    margin: 0;
    color: var(--st-semantic-text-secondary, #475569);
    font-size: 0.8rem;
    line-height: 1.45;
  }

  .pdf-missing p {
    margin: 0;
    font-size: 0.86rem;
  }

  /* #94 — rangée d'actions (Réessayer + Ouvrir) pour le cas temporaire (b). */
  .pdf-missing-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
    justify-content: center;
    margin-top: 0.15rem;
  }

  .pdf-missing-retry {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    min-height: 1.95rem;
    padding: 0.25rem 0.7rem;
    border: 1px solid var(--st-semantic-border-strong, #0f766e);
    border-radius: var(--st-radius-sm, 4px);
    background: var(--st-semantic-surface-default, #fff);
    color: var(--st-semantic-text-link, #0f766e);
    font-size: 0.78rem;
    font-weight: 650;
    cursor: pointer;
  }

  .pdf-missing-retry:hover {
    background: var(--st-semantic-surface-hover, #f1f5f9);
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
    color: var(--st-semantic-text-muted, #94a3b8);
  }

  @media (max-width: 900px) {
    .pdf-overlay {
      inset: 0.5rem;
    }
  }

  /* ── #4 — Hover-card non-modale (signal hors-filtre) ────────────────────── */
  .pdf-hovercard {
    position: absolute;
    z-index: 60;
    width: 20rem;
    max-width: calc(100% - 2rem);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.7rem 0.8rem;
    border: 1px solid var(--st-semantic-border-strong, #94a3b8);
    border-radius: var(--st-radius-md, 6px);
    background: var(--st-semantic-surface-default, #fff);
    box-shadow: 0 14px 38px rgb(15 23 42 / 0.28);
  }

  .pdf-hovercard-head {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .pdf-hovercard-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--st-semantic-text-primary, #0f172a);
    font-size: 0.84rem;
  }

  .pdf-hovercard-type {
    color: var(--st-semantic-text-muted, #64748b);
    font-size: 0.66rem;
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }

  .pdf-hovercard-meta {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.2rem 0.5rem;
    font-size: 0.74rem;
  }

  .pdf-hovercard-key {
    color: var(--st-semantic-text-muted, #64748b);
    font-weight: 600;
  }

  .pdf-hovercard-val {
    color: var(--st-semantic-text-primary, #0f172a);
    overflow-wrap: anywhere;
  }

  .pdf-hovercard-citation {
    margin: 0;
    padding: 0.4rem 0.55rem;
    border-left: 3px solid var(--st-semantic-border-subtle, #cbd5e1);
    background: var(--st-semantic-surface-subtle, #f8fafc);
    color: var(--st-semantic-text-secondary, #475569);
    font-size: 0.74rem;
    font-style: italic;
  }

  .pdf-hovercard-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }

  .pdf-hovercard-chip {
    padding: 0.05rem 0.4rem;
    border-radius: 9999px;
    font-size: 0.64rem;
    font-weight: 600;
  }

  .pdf-hovercard-chip--ok {
    background: rgb(16 185 129 / 0.16);
    color: #047857;
  }

  .pdf-hovercard-chip--missing {
    background: rgb(148 163 184 / 0.22);
    color: #475569;
  }

  .pdf-hovercard-footer {
    display: flex;
    gap: 0.4rem;
    padding-top: 0.15rem;
  }

  .pdf-hovercard-action {
    flex: 1;
    height: 1.8rem;
    border: 1px solid var(--st-semantic-border-subtle, #cbd5e1);
    border-radius: var(--st-radius-sm, 4px);
    background: var(--st-semantic-surface-default, #fff);
    color: var(--st-semantic-text-secondary, #475569);
    font-size: 0.72rem;
    font-weight: 650;
    cursor: pointer;
  }

  .pdf-hovercard-action:hover {
    background: var(--st-semantic-surface-hover, #f1f5f9);
  }

  .pdf-hovercard-action--primary {
    border-color: var(--st-semantic-border-strong, #0f766e);
    color: var(--st-semantic-text-link, #0f766e);
  }
</style>
