<script lang="ts">
  /**
   * Harnais QA — NAVIGATION PAR SIGNAL (#91) + cross-highlight (#86) + hover-card
   * (#4) du viewer de preuve. Monte UN seul SignalPdfOverlay et REPRODUIT côté
   * harnais le rôle du parent (SignauxMapView) : il détient la liste navSignals,
   * l'index courant, les `signals` du doc courant, et implémente `onNavigate`
   * (intra- ET cross-PDF : change rawRef/page/signals quand le signal cible
   * pointe un autre doc → le viewer recharge le PDF via le waiter #90 / cache
   * #89). On pilote tout depuis Playwright via `window.__setNavScenario(...)`.
   *
   * Données pilotées (scénario) : une liste de signaux { id, label, color, page,
   * rawRef, excerpt, inFilter } multi-doc. Le harnais en dérive navSignals (pour
   * la nav) et `signals` (les co-doc du signal courant, pour le surlignage).
   */
  import SignalPdfOverlay from "../../src/lib/components/maps/SignalPdfOverlay.svelte";
  import type {
    OverlaySignal,
    OverlayNavSignal,
    HoverCardData,
    SignalEvidence,
  } from "../../src/lib/signals/pdf-overlay-signals.js";

  type ScenarioSignal = {
    id: string;
    label: string;
    color: string;
    page: number;
    rawRef: string;
    docTitle: string;
    excerpt: string;
    inFilter: boolean;
    reglement?: string;
    zoneRef?: string;
  };

  let scenario = $state<ScenarioSignal[]>([]);
  let navIndex = $state(0);
  let hideOutOfFilter = $state(false);
  let hoveredSignalId = $state<string | null>(null);

  // Évidence minimale d'un signal (le viewer ne consomme que rawRef/page).
  function evidenceOf(s: ScenarioSignal): SignalEvidence {
    return {
      description: null,
      citation: s.excerpt,
      excerpt: s.excerpt,
      sourceUrl: null,
      documentUrl: null,
      rawRef: s.rawRef,
      rawObjectKey: null,
      sourceRef: null,
      documentDate: "2024-01-01",
      page: s.page,
      bbox: null,
      refs: [],
      completeness: {
        hasDescription: false,
        hasCitationExcerpt: true,
        hasPdfLink: true,
        hasDocumentDate: true,
        hasPage: true,
        hasBbox: false,
        missing: [],
      },
    };
  }

  // navSignals = TOUTE la liste filtrée (multi-doc). docId = rawRef.
  const navSignals = $derived<OverlayNavSignal[]>(
    scenario.map((s) => ({
      id: s.id,
      label: s.label,
      color: s.color,
      page: s.page,
      docId: s.rawRef,
      docTitle: s.docTitle,
      inFilter: s.inFilter,
      evidence: evidenceOf(s),
    })),
  );

  const current = $derived(scenario[navIndex] ?? null);

  // signals = signaux du DOC courant (même rawRef), courant mis en avant +
  // marquage in/out-filtre (#4).
  const signals = $derived<OverlaySignal[]>(
    current
      ? scenario
          .filter((s) => s.rawRef === current.rawRef)
          .map((s) => ({
            id: s.id,
            label: s.label,
            excerpt: s.excerpt,
            page: s.page,
            color: s.color,
            current: s.id === current.id,
            inFilter: s.inFilter,
          }))
      : [],
  );

  const rawRef = $derived(current?.rawRef ?? null);
  const page = $derived(current?.page ?? 1);

  function onNavigate(i: number): void {
    if (i >= 0 && i < scenario.length) navIndex = i;
  }

  function resolveHoverCard(id: string): HoverCardData | null {
    const s = scenario.find((x) => x.id === id);
    if (!s) return null;
    return {
      id: s.id,
      title: s.label,
      typeLabel: "Signal",
      color: s.color,
      reglement: s.reglement ?? null,
      zoneRef: s.zoneRef ?? null,
      publishedAt: null,
      documentDate: "2024-01-01",
      page: s.page,
      citation: s.excerpt,
      completeness: [
        { label: "Description", ok: false },
        { label: "Citation", ok: true },
        { label: "PDF/source", ok: true },
        { label: "Page", ok: true },
        { label: "BBox", ok: false },
      ],
    };
  }

  if (typeof window !== "undefined") {
    (
      window as unknown as {
        __setNavScenario?: (p: {
          scenario?: ScenarioSignal[];
          navIndex?: number;
          hideOutOfFilter?: boolean;
          hoveredSignalId?: string | null;
        }) => void;
      }
    ).__setNavScenario = (p) => {
      if (p.scenario) scenario = p.scenario;
      if (p.navIndex !== undefined) navIndex = p.navIndex;
      if (p.hideOutOfFilter !== undefined) hideOutOfFilter = p.hideOutOfFilter;
      if (p.hoveredSignalId !== undefined) hoveredSignalId = p.hoveredSignalId;
    };
    // Sonde l'état de hover émis par le viewer (pour le sens viewer→fiche #86).
    (window as unknown as { __lastHover?: string | null }).__lastHover = null;
  }

  function onSignalHover(id: string | null): void {
    (window as unknown as { __lastHover?: string | null }).__lastHover = id;
  }
</script>

{#if current}
  <SignalPdfOverlay
    title="Preuve QA nav"
    {rawRef}
    sourceUrl={null}
    {page}
    excerpt={null}
    {signals}
    {navSignals}
    {navIndex}
    {onNavigate}
    {hideOutOfFilter}
    onToggleHideOutOfFilter={(h) => (hideOutOfFilter = h)}
    {onSignalHover}
    {hoveredSignalId}
    {resolveHoverCard}
    onMakeCurrent={(id) => {
      const i = scenario.findIndex((s) => s.id === id);
      if (i >= 0) navIndex = i;
    }}
    onAddToFilter={(id) => {
      // Simule « ajouter au filtre » : marque le signal in-filter + le rend courant.
      scenario = scenario.map((s) =>
        s.id === id ? { ...s, inFilter: true } : s,
      );
      const i = scenario.findIndex((s) => s.id === id);
      if (i >= 0) navIndex = i;
    }}
    onClose={() => {}}
  />
{/if}
