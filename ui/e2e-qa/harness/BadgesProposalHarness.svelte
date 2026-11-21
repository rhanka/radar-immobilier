<script lang="ts">
  import { onMount } from "svelte";
  import { Badge, ThemeProvider } from "@sentropic/design-system-svelte";
  import { sentTechTheme } from "@sentropic/design-system-themes";
  import SignalAnnotationBadgesDemo from "../../src/lib/components/maps/SignalAnnotationBadgesDemo.svelte";
  import type {
    AnnotationBadgeInput,
    AnnotationBadgeVariant,
  } from "../../src/lib/signals/annotation-badge-model.js";

  interface Scenario {
    readonly id: string;
    readonly stateTitle: string;
    readonly signalTitle: string;
    readonly stage: string;
    readonly classe: "Pertinent" | "À surveiller" | "Écarté" | "Non classé";
    readonly classeTone: "success" | "warning" | "neutral";
    readonly docDate: string;
    readonly input: AnnotationBadgeInput;
    readonly defaultTooltipIndex?: number;
  }

  const AI_STANDARD = {
    classe: "a_surveiller" as const,
    model: "gpt-6.2-astra",
    effort: "low",
    promptId: "v2",
    updatedAt: "2026-11-21T12:00:00Z",
    channel: "Pipeline" as const,
  };

  const SCENARIOS: readonly Scenario[] = [
    {
      id: "ai",
      stateTitle: "1. IA",
      signalTitle: "Règlement 26-956 — densification résidentielle zone H-12",
      stage: "Rezonage, avis de motion",
      classe: "À surveiller",
      classeTone: "warning",
      docDate: "2026-11-09",
      input: { ai: AI_STANDARD },
    },
    {
      id: "ai-ambiguous",
      stateTitle: "2. IA ambigu",
      signalTitle: "PPCMOI 2026-14 — projet mixte rue Principale",
      stage: "PPCMOI, projet de résolution",
      classe: "À surveiller",
      classeTone: "warning",
      docDate: "2026-11-12",
      input: { ai: { ...AI_STANDARD, ambiguous: true } },
    },
    {
      id: "manual",
      stateTitle: "3. Manuel (humain UI)",
      signalTitle: "Règlement 2026-41 — ajout d'usages multifamiliaux H-04",
      stage: "Rezonage, projet de règlement",
      classe: "Pertinent",
      classeTone: "success",
      docDate: "2026-11-04",
      input: { manual: { actor: "F. Antoine", updatedAt: "2026-11-21", channel: "UI" } },
    },
    {
      id: "human-validated",
      stateTitle: "4. Validé par un humain",
      signalTitle: "Règlement 1842 — hausse de la hauteur maximale à 4 étages",
      stage: "Rezonage, avis de motion",
      classe: "Pertinent",
      classeTone: "success",
      docDate: "2026-11-10",
      input: {
        humanFeedback: { verdict: "up", actor: "F. Antoine", updatedAt: "2026-11-21", channel: "UI" },
      },
    },
    {
      id: "human-reclassified",
      stateTitle: "5. Reclassé par un humain",
      signalTitle: "Modification grille C-08 — usages commerciaux de proximité",
      stage: "Grille des usages, adoption",
      classe: "Écarté",
      classeTone: "neutral",
      docDate: "2026-11-03",
      input: {
        humanFeedback: {
          verdict: "down",
          actor: "F. Antoine",
          reasonCode: "N-NON-RES",
          updatedAt: "2026-11-21",
          channel: "UI",
        },
      },
    },
    {
      id: "mcp-pending",
      stateTitle: "6. MCP à confirmer",
      signalTitle: "Dérogation mineure 2026-88 — marge latérale 6 logements",
      stage: "Dérogation mineure, avis public",
      classe: "À surveiller",
      classeTone: "warning",
      docDate: "2026-11-18",
      input: {
        mcp: { model: "claude-opus-4-6", validation: "auto", pendingHuman: true, updatedAt: "2026-11-21" },
      },
    },
    {
      id: "mcp-auto",
      stateTitle: "7. MCP validé auto",
      signalTitle: "Règlement 2026-73 — retrait d'une limite de logements",
      stage: "Rezonage, projet de règlement",
      classe: "Pertinent",
      classeTone: "success",
      docDate: "2026-11-16",
      input: {
        mcp: { model: "claude-opus-4-6", validation: "auto", pendingHuman: false, updatedAt: "2026-11-21" },
      },
    },
    {
      id: "human-mcp-elicitation",
      stateTitle: "8. Humain via MCP + élicitation",
      signalTitle: "Règlement 2026-91 — conversion résidentielle secteur gare",
      stage: "Rezonage, avis de motion",
      classe: "Pertinent",
      classeTone: "success",
      docDate: "2026-11-19",
      input: {
        mcp: {
          model: "claude-opus-4-6",
          validation: "human",
          pendingHuman: false,
          actor: "F. Antoine",
          updatedAt: "2026-11-21",
        },
      },
    },
    {
      id: "unclassified",
      stateTitle: "9. Non classé (aucun badge)",
      signalTitle: "Ordre du jour du 24 novembre 2026 — point urbanisme 4.2",
      stage: "Rezonage, avis de motion",
      classe: "Non classé",
      classeTone: "neutral",
      docDate: "2026-11-24",
      input: {},
    },
    {
      id: "human-plus-ai",
      stateTitle: "10a. Humain + IA ensemble (reclassé + IA)",
      signalTitle: "Règlement 2026-64 — densification douce 8 logements H-19",
      stage: "Rezonage, projet de règlement",
      classe: "Pertinent",
      classeTone: "success",
      docDate: "2026-11-14",
      input: {
        humanFeedback: {
          verdict: "down",
          actor: "F. Antoine",
          reasonCode: "P-DENSIF",
          updatedAt: "2026-11-21",
          channel: "UI",
        },
        ai: AI_STANDARD,
      },
      defaultTooltipIndex: 1,
    },
    {
      id: "elicitation-plus-ai",
      stateTitle: "10b. Humain + IA ensemble (MCP + élicitation + IA)",
      signalTitle: "PPCMOI 2026-22 — complexe résidentiel 24 unités TOD",
      stage: "PPCMOI, avis de motion",
      classe: "Pertinent",
      classeTone: "success",
      docDate: "2026-11-17",
      input: {
        mcp: {
          model: "claude-opus-4-6",
          validation: "human",
          pendingHuman: false,
          actor: "F. Antoine",
          updatedAt: "2026-11-21",
        },
        ai: { ...AI_STANDARD, ambiguous: true },
      },
      defaultTooltipIndex: 0,
    },
  ];

  const VARIANT_META: Record<AnnotationBadgeVariant, { title: string; subtitle: string }> = {
    a: {
      title: "Variante A — Pastille icône pure",
      subtitle: "Badge circulaire DS ultra-compact (icône seule + infobulle). Seul « MCP + élicitation » conserve son tag.",
    },
    b: {
      title: "Variante B — Icône + mot court (recommandée)",
      subtitle: "Badge pilule DS : icône + 1 mot court (IA, Manuel, Validé, Reclassé, MCP). Détail technique au survol / focus.",
    },
    c: {
      title: "Variante C — Tag DS discret + statut",
      subtitle: "Tag DS sobre : l'IA standard reste neutre, seules les alertes et validations humaines prennent de la couleur.",
    },
  };

  const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const rawVariant = params.get("variant");
  const initialVariant: AnnotationBadgeVariant | "all" =
    rawVariant === "a" || rawVariant === "b" || rawVariant === "c" ? rawVariant : "all";
  const initialTheme: "light" | "dark" = params.get("theme") === "dark" ? "dark" : "light";
  const openTooltipScenario = params.get("openTooltip") ?? "human-plus-ai";
  const openTooltipIndexParam = params.get("openTooltipIndex");

  let activeVariant: AnnotationBadgeVariant | "all" = $state(initialVariant);
  let theme: "light" | "dark" = $state(initialTheme);

  const visibleVariants = $derived<AnnotationBadgeVariant[]>(
    activeVariant === "all" ? ["a", "b", "c"] : [activeVariant],
  );

  function forcedIndexFor(scenario: Scenario): number | null {
    if (openTooltipScenario !== scenario.id) return null;
    if (openTooltipIndexParam !== null) {
      const parsed = Number(openTooltipIndexParam);
      return Number.isInteger(parsed) ? parsed : 0;
    }
    return scenario.defaultTooltipIndex ?? 0;
  }

  $effect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = theme;
    }
  });

  onMount(() => {
    document.documentElement.dataset.theme = theme;
    const ready = document.getElementById("ready");
    if (ready) ready.textContent = "ready";
  });
</script>

<ThemeProvider theme={sentTechTheme}>
  <div class="demo-shell" data-theme={theme} class:demo-shell--dark={theme === "dark"}>
    <header class="demo-header">
      <div>
        <h1>Badges d'annotation — proposition icône + infobulle</h1>
        <p class="demo-sub">
          Composants DS Sentropic (<code>Badge</code>, <code>Tag</code>, <code>Tooltip</code>) + icônes
          <code>@lucide/svelte</code>. Mode : <strong>{theme === "dark" ? "Sombre" : "Clair"}</strong>.
        </p>
      </div>
      <div class="demo-controls">
        <button type="button" class:active={activeVariant === "all"} onclick={() => (activeVariant = "all")}>
          Toutes
        </button>
        <button type="button" class:active={activeVariant === "a"} onclick={() => (activeVariant = "a")}>
          Variante A
        </button>
        <button type="button" class:active={activeVariant === "b"} onclick={() => (activeVariant = "b")}>
          Variante B
        </button>
        <button type="button" class:active={activeVariant === "c"} onclick={() => (activeVariant = "c")}>
          Variante C
        </button>
        <button type="button" onclick={() => (theme = theme === "light" ? "dark" : "light")}>
          {theme === "light" ? "Basculer sombre" : "Basculer clair"}
        </button>
      </div>
    </header>

    <main class="demo-columns" class:demo-columns--single={visibleVariants.length === 1}>
      {#each visibleVariants as variant (variant)}
        <section class="demo-panel" data-testid="variant-column-{variant}">
          <div class="demo-panel-head">
            <h2>{VARIANT_META[variant].title}</h2>
            <p>{VARIANT_META[variant].subtitle}</p>
          </div>

          <div class="demo-list">
            {#each SCENARIOS as scenario, idx (scenario.id)}
              <article class="demo-card" data-scenario={scenario.id}>
                <div class="demo-card-state">{scenario.stateTitle}</div>
                <div class="demo-card-row">
                  <div class="demo-card-main">
                    <div class="demo-card-title">{scenario.signalTitle}</div>
                    <div class="demo-card-meta">
                      <SignalAnnotationBadgesDemo
                        input={scenario.input}
                        {variant}
                        scenarioId={scenario.id}
                        tooltipPlacement={idx === 0 ? "bottom" : "top"}
                        forceOpenIndex={forcedIndexFor(scenario)}
                      />
                      <span class="demo-stage-chip">{scenario.stage}</span>
                    </div>
                  </div>
                  <div class="demo-card-classe">
                    <Badge tone={scenario.classeTone} size="sm" class="demo-classe-badge demo-classe-badge--{scenario.classeTone}">
                      {scenario.classe}
                    </Badge>
                  </div>
                </div>
                <div class="demo-card-dates">Date doc. {scenario.docDate}</div>
              </article>
            {/each}
          </div>
        </section>
      {/each}
    </main>
  </div>
</ThemeProvider>

<style>
  .demo-shell {
    min-height: 100vh;
    padding: 1.25rem 1.5rem 2.5rem;
    background: var(--st-semantic-surface-subtle, #f8fafc);
    color: var(--st-semantic-text-primary, #0f172a);
    box-sizing: border-box;
  }

  .demo-shell--dark {
    --st-semantic-surface-default: #0f172a;
    --st-semantic-surface-subtle: #1e293b;
    --st-semantic-surface-raised: #1e293b;
    --st-semantic-surface-inverse: #f8fafc;
    --st-semantic-text-primary: #f8fafc;
    --st-semantic-text-secondary: #cbd5e1;
    --st-semantic-text-muted: #94a3b8;
    --st-semantic-text-inverse: #0f172a;
    --st-semantic-border-subtle: #334155;
    --st-semantic-border-strong: #475569;
    --st-semantic-border-interactive: #38bdf8;
    --st-component-tooltip-background: #f8fafc;
    --st-component-tooltip-text: #0f172a;
    --st-component-tooltip-shadow: 0 10px 28px rgb(0 0 0 / 0.45);
    background: #020617;
    color: #f8fafc;
  }

  .demo-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
    margin-bottom: 1.25rem;
    padding-bottom: 0.9rem;
    border-bottom: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
  }

  .demo-header h1 {
    margin: 0 0 0.25rem;
    font-size: 1.15rem;
    font-weight: 700;
  }

  .demo-sub {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--st-semantic-text-secondary, #475569);
  }

  .demo-controls {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
  }

  .demo-controls button {
    padding: 0.35rem 0.65rem;
    border-radius: 0.375rem;
    border: 1px solid var(--st-semantic-border-subtle, #cbd5e1);
    background: var(--st-semantic-surface-default, #ffffff);
    color: var(--st-semantic-text-primary, #0f172a);
    font-size: 0.75rem;
    font-weight: 600;
  }

  .demo-controls button.active {
    border-color: var(--st-semantic-border-interactive, #0284c7);
    background: var(--st-semantic-surface-subtle, #eff6ff);
  }

  .demo-columns {
    display: grid;
    grid-template-columns: repeat(3, minmax(22rem, 26rem));
    gap: 1.25rem;
    align-items: start;
  }

  .demo-columns--single {
    grid-template-columns: minmax(24rem, 28rem);
  }

  .demo-panel {
    border-radius: 0.5rem;
    border: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
    background: var(--st-semantic-surface-default, #ffffff);
    overflow: visible;
  }

  .demo-panel-head {
    padding: 0.75rem 0.85rem;
    border-bottom: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
  }

  .demo-panel-head h2 {
    margin: 0 0 0.2rem;
    font-size: 0.9375rem;
    font-weight: 700;
  }

  .demo-panel-head p {
    margin: 0;
    font-size: 0.75rem;
    line-height: 1.4;
    color: var(--st-semantic-text-secondary, #475569);
  }

  .demo-list {
    display: flex;
    flex-direction: column;
  }

  .demo-card {
    padding: 0.55rem 0.85rem;
    border-bottom: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
    position: relative;
  }

  .demo-card:last-child {
    border-bottom: none;
  }

  .demo-card-state {
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--st-semantic-text-muted, #64748b);
    margin-bottom: 0.25rem;
  }

  .demo-card-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .demo-card-main {
    flex: 1 1 auto;
    min-width: 0;
  }

  .demo-card-title {
    font-size: 0.8125rem;
    font-weight: 600;
    line-height: 1.35;
    color: var(--st-semantic-text-primary, #0f172a);
    margin-bottom: 0.3rem;
  }

  .demo-card-meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .demo-stage-chip {
    display: inline-flex;
    align-items: center;
    padding: 0.1rem 0.45rem;
    border-radius: 999px;
    border: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
    background: var(--st-semantic-surface-subtle, #f1f5f9);
    color: var(--st-semantic-text-secondary, #475569);
    font-size: 0.6875rem;
    font-weight: 600;
    white-space: nowrap;
  }

  .demo-card-classe {
    flex-shrink: 0;
  }

  .demo-card-dates {
    margin-top: 0.28rem;
    font-size: 0.6875rem;
    color: var(--st-semantic-text-muted, #64748b);
  }

  :global([data-theme="dark"] .demo-classe-badge--success) {
    background: rgb(34 197 94 / 0.2);
    color: #86efac;
  }

  :global([data-theme="dark"] .demo-classe-badge--warning) {
    background: rgb(245 158 11 / 0.22);
    color: #fcd34d;
  }

  :global([data-theme="dark"] .demo-classe-badge--neutral) {
    background: #334155;
    color: #cbd5e1;
  }
</style>
