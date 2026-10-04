<script>
  import Scenes from './Scenes.svelte';
  import Sections from './Sections.svelte';
  import DecisionChoices from './DecisionChoices.svelte';
  import { PROTOCOL } from './protocol.js';
  import { graphs, header, glossary, decisionSections, annexes, manifest } from './.generated/data.json';
  const [intention, wants, synthesis, ...body] = decisionSections;
</script>

<div data-st-theme="entropic">
  <main class="dossier">
    <header class="masthead">
      <div class="flex-row">
        <span class="eyebrow">Dossier de décision · pour Farid (Product Owner), validation technique Fabien · 21 septembre 2026</span>
        <span class="badge warning">5 SCÈNES · 12 SECTIONS · 16 DÉCISIONS · 3 OCTOBRE 2026</span>
      </div>
      <h1>Analyse des retours d’usage<br>du 21 septembre 2026</h1>
      <p class="subtitle">Capitalisation des données annotées, vers de nouveaux critères de ciblage</p>
      <p class="lede">Steve Chaperon (Chaperon Immobilier), client et utilisateur du radar, a trié 124 signaux de 51 municipalités, contrôlé 121 exclusions et posé 26 règles.
        Sur sa vue de travail (73 signaux), 24 sont du bruit et 22 seulement réunissent ses trois critères :
        résidentiel, assouplissement, densification. Le dossier propose de conserver tout le classeur avec sa provenance,
        de l’afficher sur les objets concernés selon le contrat d’annotation de la plateforme commune sentropic, et de construire un oracle de ciblage
        qui mesure une nouvelle sélection proposée (vue C) contre la sélection affichée aujourd’hui (vue B) — sans toucher à la priorité n° 1 de Steve, le rafraîchissement.</p>
      <section class="protocol" data-protocol aria-labelledby="protocol-title">
        <h2 id="protocol-title">{PROTOCOL.title}</h2>
        <table>
          <thead><tr><th scope="col">Passe</th><th scope="col">Filtres</th><th scope="col" class="num">Signaux</th><th scope="col">But</th></tr></thead>
          <tbody>{#each PROTOCOL.passes as row}<tr data-pass={row.pass}><th scope="row">{row.pass}</th><td>{row.filters}</td><td class="num">{row.signals}</td><td>{row.aim}</td></tr>{/each}</tbody>
        </table>
        <p>{PROTOCOL.summary}</p>
      </section>
      <div class="truth-strip">
        <span><strong>124 LIGNES</strong> 40 P · 29 S · 55 N</span>
        <span><strong>PASSE 1</strong> 34 / 15 / 24 sur 73</span>
        <span><strong>22 / 73</strong> trois critères réunis</span>
        <span><strong>39 / 69</strong> composants Svelte avec le DS</span>
        <span><strong>2 CRITÈRES SUR 3</strong> sans donnée au radar</span>
        <span><strong>3 POINTS OUVERTS</strong> D9 · D12 · D13</span>
      </div>
    </header>

    <section class="reading-map" aria-label="Comment lire ce dossier">
      <h2>Comment lire ce dossier</h2>
      <ol>
        <li><strong>D’abord l’intention de l’owner et ce que veut Steve</strong>, dépliées : objectifs et renvois, destinataires et rôles (§1.1), glossaire en tête, trois critères cités et chiffrés, écart avec l’existant.</li>
        <li><strong>La synthèse et les 16 décisions</strong>, dépliées, puis les neuf autres sections dans leur texte d’origine.</li>
        <li><strong>Cinq scènes</strong> : critères de Steve en regard de l’existant (matrice), modèle de données (entité-relation), architecture de l’import à l’affichage avec l’oracle transversal (couloirs), architecture UI, affichage A/B/C.</li>
        <li><strong>Les décisions D1 à D16, dans l’ordre où elles se prennent</strong> : Fabien décide d’abord ses 7 décisions techniques (D1 déjà actée par l’owner le 2026-10-04 ; les autres prises telles quelles sauf incohérence), puis Farid ses 9 décisions produit. Chacune s’ouvre sur une introduction, ses dépendances et, par option, avantages et inconvénients ; sélectionnables, à copier en YAML dans la PR GitHub — brouillon local seulement.</li>
        <li><strong>L’annexe A</strong> : convergence et divergences entre les deux auteurs, avec la source qui tranche.</li>
      </ol>
      <p class="caption">Conventions : <code>FAIT</code> = constaté dans une source citée · <code>CALCUL</code> = dérivé des
        données · <code>JUGEMENT</code> = appréciation · <code>non vérifié</code>, <code>source manquante</code>,
        <code>N-A</code> = limites déclarées.</p>
    </section>

    <Sections sections={[glossary]} label="Glossaire" open={true} />
    <Sections sections={[header]} label="En-tête du dossier" open={false} />
    <Sections sections={[intention, wants]} label="Intention du dossier et ce que veut Steve" open={true} />
    <Sections sections={[synthesis]} label="Synthèse et décisions demandées" open={true} />
    <Sections sections={body} label="Les sections du dossier" open={false} />
    <Scenes {graphs} />
    <DecisionChoices {manifest} />
    <Sections sections={annexes} label="Annexe du dossier" open={false} />

    <footer>
      <strong>Preuves embarquées · page autonome hors ligne</strong>
      <p>Cinq scènes tirées des sources canoniques de l’annexe B : une matrice (tableau Markdown), un diagramme
        entité-relation (<code>erDiagram</code>), une architecture en couloirs (<code>flowchart</code>, un couloir par
        <code>subgraph</code>, oracle en bande basse), puis deux scènes de composants en SvelteFlow natif, conteneurs
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
  .protocol { margin: 22px 0 8px; padding: 16px 20px; max-width: 1200px; border-left: 5px solid var(--st-semantic-data-category2); background: var(--st-semantic-surface-subtle); }
  .protocol { overflow-x: auto; }
  @media (max-width: 640px) {
    :global(.dossier) { padding: 20px 16px 40px; }
    :global(.truth-strip) { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .protocol { padding: 12px; }
    .protocol table { min-width: 560px; }
  }
  .protocol h2 { margin: 0 0 10px; font-size: 1.1rem; }
  .protocol table { width: 100%; border-collapse: collapse; font-size: .9rem; }
  .protocol th, .protocol td { padding: 8px 10px; border-bottom: 1px solid var(--st-semantic-border-subtle); text-align: left; vertical-align: top; }
  .protocol .num, .protocol tbody th { white-space: nowrap; }
  .protocol .num { text-align: right; }
  .protocol p { margin: 10px 0 0; font-size: .92rem; line-height: 1.55; }
  .reading-map { margin-block: 28px; padding: 22px 24px; border: 1px solid var(--st-semantic-border-subtle); background: var(--st-semantic-surface-subtle); }
  .reading-map h2 { margin-top: 0; font-size: 1.3rem; }
  .reading-map ol { margin: 0 0 14px; padding-left: 22px; line-height: 1.7; font-size: .95rem; }
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
