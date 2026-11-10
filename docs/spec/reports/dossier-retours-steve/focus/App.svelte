<script>
  import Sections from './Sections.svelte';
  import DecisionChoices from './DecisionChoices.svelte';
  import { header, decisionSections, annexes, manifest } from './.generated/data.json';
  // Plan adopté (§B6) : l'ouverture, les chapitres 1 à 3 dépliés, puis les chapitres 4 à 10,
  // le bloc de copie des décisions et les annexes A à F, repliés.
  const [intention, wants, rule, ...body] = decisionSections;
</script>

<div data-st-theme="entropic">
  <main class="dossier">
    <header class="masthead">
      <div class="flex-row">
        <span class="eyebrow" data-banner>{manifest.banner}</span>
      </div>
      <h1>Analyse des retours d’usage<br>du 21 septembre 2026</h1>
      <p class="subtitle">Capitalisation des données annotées, vers de nouveaux critères de ciblage</p>
    </header>

    <Sections sections={[header]} label="Ouverture" open={true} />
    <Sections sections={[intention, wants, rule]} label="Intention, ce que veut Steve, comment un signal est retenu ou écarté" open={true} />
    <Sections sections={body} label="Les chapitres du dossier" open={false} />
    <DecisionChoices {manifest} />
    <Sections sections={annexes} label="Annexes du dossier" open={false} />

    <footer>
      <strong>Preuves embarquées · page autonome hors ligne</strong>
      <p>Cinq scènes tirées des sources canoniques de <code>SCENES_FOCUS.md</code> (hors du rapport), rendues dans leurs chapitres : une matrice (tableau Markdown), un diagramme
        entité-relation (<code>erDiagram</code>), une architecture en couloirs (<code>flowchart</code>, un couloir par
        <code>subgraph</code>, jeu de référence en bande basse), puis deux scènes de composants en SvelteFlow natif, conteneurs
        <code>parentId</code> réels, gabarit A’ 460 × 200, Dagre <code>rankdir LR</code> et routeur orthogonal du kit h2a —
        la chaîne de <code>docs/architecture/focus</code>, importée, pas recopiée. Thèmes clair et sombre.
        Empreinte du dossier : <code>{manifest.dossierHash.slice(0, 16)}…</code> ·
        empreinte d’entrée : <code>{manifest.artifactInputHash.slice(0, 16)}…</code>.</p>
      <p>Ouvrir cette page n’exécute rien : aucune migration, aucun import, aucun appel de modèle, aucune fusion de PR,
        aucune action de production ou de cluster, aucun événement track.</p>
    </footer>
  </main>
</div>

<style>
  .subtitle { margin: 6px 0 18px; font-size: 1.6rem; font-weight: 600; line-height: 1.3; color: var(--st-semantic-text-secondary); }
  @media (max-width: 640px) {
    :global(.dossier) { padding: 20px 16px 40px; }
  }
  footer { margin-top: 44px; padding-top: 20px; border-top: 3px solid var(--st-semantic-border-strong); }
  :global(.prose table) { display: block; overflow-x: auto; max-width: 100%; }
  /* Light theme extras (coverage colours), then the dark theme: system preference unless
     the host forces data-theme="light", or forced by data-theme="dark". */
  :global([data-st-theme]) { --dossier-ok:#147342; --dossier-ok-bg:#e5f7ec; --dossier-ok-text:#0f5a33; --dossier-partial:#b87812; --dossier-partial-bg:#fff4dc; --dossier-partial-text:#7a4e06; --dossier-gap:#b3261e; --dossier-gap-bg:#fdecea; --dossier-gap-text:#8c1d18; --chart-p:#1f7a4d; --chart-s:#9a5b00; --chart-n:#b3261e; --chart-g0:#145f68; --chart-g1:#b87812; --chart-on:#ffffff; }
  @media (prefers-color-scheme: dark) {
    :global(html:not([data-theme='light']) [data-st-theme]) { --st-semantic-surface-default:#0f171d; --st-semantic-surface-raised:#16222a; --st-semantic-surface-subtle:#1b2a33; --st-semantic-text-primary:#e4edf0; --st-semantic-text-secondary:#a7bac0; --st-semantic-border-strong:#7f99a1; --st-semantic-border-subtle:#34474f; --st-semantic-action-primary:#5ec3ce; --st-semantic-data-category1:#4fb0bc; --st-semantic-data-category2:#e9a43c; --st-semantic-data-category7:#a58fd8;
      --dossier-ok:#4cc68a; --dossier-ok-bg:#12301f; --dossier-ok-text:#9fe5bf; --dossier-partial:#e9a43c; --dossier-partial-bg:#3a2a0c; --dossier-partial-text:#f6cf8c; --dossier-gap:#f07167; --dossier-gap-bg:#3b1614; --dossier-gap-text:#f8b4ae; --chart-p:#4cc68a; --chart-s:#e9a43c; --chart-n:#f07167; --chart-g0:#4fb0bc; --chart-g1:#e9a43c; --chart-on:#0f171d;
      --xy-background-color:#1b2a33; --xy-background-pattern-color:#34474f; --xy-minimap-background-color:#16222a; --xy-minimap-mask-background-color:rgb(15 23 29 / 60%); --xy-minimap-node-background-color:#34474f;
      --xy-controls-button-background-color:#16222a; --xy-controls-button-background-color-hover:#1b2a33; --xy-controls-button-color:#e4edf0; --xy-controls-button-color-hover:#ffffff; --xy-controls-button-border-color:#34474f;
      --xy-edge-stroke:#a7bac0; --xy-node-background-color:#16222a; --xy-node-color:#e4edf0; color-scheme: dark; }
    :global(html:not([data-theme='light'])) :global(.badge), :global(html:not([data-theme='light'])) :global(button), :global(html:not([data-theme='light'])) :global(textarea), :global(html:not([data-theme='light'])) :global(.summary-grid article) { background: var(--st-semantic-surface-raised); color: var(--st-semantic-text-primary); }
  :global(html:not([data-theme='light'])) :global(.badge.warning) { background: var(--dossier-partial-bg); border-color: var(--dossier-partial); color: var(--dossier-partial-text); }
  :global(html:not([data-theme='light'])) :global(.badge.selected) { background: var(--dossier-ok-bg); border-color: var(--dossier-ok); color: var(--dossier-ok-text); }
  }
  :global(html[data-theme='dark'] [data-st-theme]) { --st-semantic-surface-default:#0f171d; --st-semantic-surface-raised:#16222a; --st-semantic-surface-subtle:#1b2a33; --st-semantic-text-primary:#e4edf0; --st-semantic-text-secondary:#a7bac0; --st-semantic-border-strong:#7f99a1; --st-semantic-border-subtle:#34474f; --st-semantic-action-primary:#5ec3ce; --st-semantic-data-category1:#4fb0bc; --st-semantic-data-category2:#e9a43c; --st-semantic-data-category7:#a58fd8;
      --dossier-ok:#4cc68a; --dossier-ok-bg:#12301f; --dossier-ok-text:#9fe5bf; --dossier-partial:#e9a43c; --dossier-partial-bg:#3a2a0c; --dossier-partial-text:#f6cf8c; --dossier-gap:#f07167; --dossier-gap-bg:#3b1614; --dossier-gap-text:#f8b4ae; --chart-p:#4cc68a; --chart-s:#e9a43c; --chart-n:#f07167; --chart-g0:#4fb0bc; --chart-g1:#e9a43c; --chart-on:#0f171d;
      --xy-background-color:#1b2a33; --xy-background-pattern-color:#34474f; --xy-minimap-background-color:#16222a; --xy-minimap-mask-background-color:rgb(15 23 29 / 60%); --xy-minimap-node-background-color:#34474f;
      --xy-controls-button-background-color:#16222a; --xy-controls-button-background-color-hover:#1b2a33; --xy-controls-button-color:#e4edf0; --xy-controls-button-color-hover:#ffffff; --xy-controls-button-border-color:#34474f;
      --xy-edge-stroke:#a7bac0; --xy-node-background-color:#16222a; --xy-node-color:#e4edf0; color-scheme: dark; }
  :global(html[data-theme='dark']) :global(.badge), :global(html[data-theme='dark']) :global(button), :global(html[data-theme='dark']) :global(textarea), :global(html[data-theme='dark']) :global(.summary-grid article) { background: var(--st-semantic-surface-raised); color: var(--st-semantic-text-primary); }
  :global(html[data-theme='dark']) :global(.badge.warning) { background: var(--dossier-partial-bg); border-color: var(--dossier-partial); color: var(--dossier-partial-text); }
  :global(html[data-theme='dark']) :global(.badge.selected) { background: var(--dossier-ok-bg); border-color: var(--dossier-ok); color: var(--dossier-ok-text); }
</style>
