<script>
  import Scenes from './Scenes.svelte';
  import Sections from './Sections.svelte';
  import TableDiagram from './TableDiagram.svelte';
  import GroupsTable from './GroupsTable.svelte';
  import DecisionChoices from './DecisionChoices.svelte';
  import { graphs, header, intention, context, synthesis, body, optionsIntro, decisionDetails, annexes, manifest } from './.generated/data.json';
</script>

<div data-st-theme="entropic">
  <main class="dossier">
    <header class="masthead">
      <div class="flex-row">
        <span class="eyebrow">Dossier de décision · pour Fabien (owner, AI Builder) · Farid (PO) consulté sur D2 et D3 · carte #812</span>
        <span class="badge warning">1 SCÈNE · 1 FIGURE · 9 SECTIONS · 7 DÉCISIONS · 4 OCTOBRE 2026</span>
      </div>
      <h1>Villes dont la base et le graphe stocké<br>ne concordent plus</h1>
      <p class="subtitle">Corriger le mélange de nœuds entre villes et remettre 226 villes en cohérence</p>
      <p class="lede">Chaque ville a deux copies de son graphe : un fichier dans S3, produit par le rafraîchissement, et des lignes dans la base PG, que l’application sert.
        Après la reprise des dates du 3 octobre, 226 villes ont deux copies différentes. Cause principale : les identifiants de nœuds ne sont pas propres à une ville,
        et la base n’a qu’une clé <code>id</code> ; quand deux villes ont le même identifiant, la seconde écrase le contenu de la première.
        Résultat : 109 villes affichent des preuves venant d’une autre ville, alors que S3 est propre. Le dossier explique le contexte, puis demande sept décisions.</p>
      <div class="truth-strip">
        <span><strong>226 VILLES EN ÉCART</strong> 205 stoppées · 21 avortées</span>
        <span><strong>109 VILLES</strong> 164 nœuds aux preuves d’une autre ville</span>
        <span><strong>0 CAS DANS S3</strong> les 226 latest.json sont propres</span>
        <span><strong>3 535 NŒUDS VIDES</strong> dans PG seulement, 71 villes</span>
        <span><strong>65 VILLES / PASSAGE</strong> extraites puis refusées</span>
      </div>
    </header>

    <section class="reading-map" aria-label="Comment lire ce dossier">
      <h2>Comment lire ce dossier</h2>
      <ol>
        <li><strong>D’abord l’intention et le contexte</strong>, dépliés : ce que sont S3 et PG, qui lit quoi, la projection et ses garde-fous, le job de reprise et <code>--heal</code>, l’ancien flux d’exploitation, pourquoi les villes ont divergé (§1, §2).</li>
        <li><strong>La Scène 1</strong> : l’architecture réelle en cinq couloirs verticaux, de gauche à droite, avec l’endroit où naît l’écart et celui de la collision.</li>
        <li><strong>La Figure 2</strong> : les tables <code>graph_nodes</code> et <code>graph_edges</code>, et la ligne <code>bylaw-242</code> partagée par gore et barkmere.</li>
        <li><strong>Le Tableau 3</strong> : les huit groupes de villes, leurs comptes et leur remède ; puis la synthèse, l’ordre et les dépendances entre décisions (§3).</li>
        <li><strong>Les décisions D1 à D7</strong>, toutes décidées par Fabien, chacune avec son problème, ses options (avantages, inconvénients) et la recommandation, sélectionnables et à copier en YAML dans la PR — brouillon local seulement.</li>
        <li><strong>Les autres sections</strong> (collision, groupes, principes de réparation, ordre d’exécution, risques) et l’annexe A (listes des villes).</li>
      </ol>
      <p class="caption">Conventions : <code>FAIT</code> = constaté dans une source citée · <code>CALCUL</code> = dérivé des
        données · <code>JUGEMENT</code> = appréciation · <code>non vérifié</code>, <code>source manquante</code>,
        <code>N-A</code> = limites déclarées.</p>
    </section>

    <Sections sections={[header]} label="En-tête du dossier" open={false} />
    <Sections sections={[intention, context]} label="Intention du dossier et contexte" open={true} />
    <Scenes {graphs} />
    <TableDiagram />
    <GroupsTable />
    <Sections sections={[synthesis]} label="Synthèse et décisions demandées" open={true} />
    <DecisionChoices {manifest} details={decisionDetails} intro={optionsIntro} />
    <Sections sections={body} label="Les autres sections du dossier" open={false} />
    <Sections sections={annexes} label="Annexe du dossier" open={false} />

    <footer>
      <strong>Preuves embarquées · page autonome hors ligne</strong>
      <p>Un graphe Mermaid canonique rendu en SvelteFlow natif, couloirs <code>parentId</code> réels,
        gabarit unique A’ 460 × 200 à l’échelle 1, placement Dagre récursif <code>rankdir LR</code> et routeur
        orthogonal du kit h2a — la chaîne de <code>docs/architecture/focus</code>, importée, pas recopiée. La Figure 2 est un diagramme de tables, sans carte de composant.
        Empreinte du dossier : <code>{manifest.dossierHash.slice(0, 16)}…</code> ·
        empreinte d’entrée : <code>{manifest.artifactInputHash.slice(0, 16)}…</code>.</p>
      <p>Ouvrir cette page n’exécute rien : aucune réparation, aucun job, aucune écriture dans un cluster, un bucket ou une base,
        aucune fusion de PR, aucun événement track.</p>
    </footer>
  </main>
</div>

<style>
  .subtitle { margin: 6px 0 18px; font-size: 1.6rem; font-weight: 600; line-height: 1.3; color: var(--st-semantic-text-secondary); }
  .reading-map { margin-block: 28px; padding: 22px 24px; border: 1px solid var(--st-semantic-border-subtle); background: var(--st-semantic-surface-subtle); }
  .reading-map h2 { margin-top: 0; font-size: 1.3rem; }
  .reading-map ol { margin: 0 0 14px; padding-left: 22px; line-height: 1.7; font-size: .95rem; }
  footer { margin-top: 44px; padding-top: 20px; border-top: 3px solid var(--st-semantic-border-strong); }
  :global(.prose table) { display: block; overflow-x: auto; max-width: 100%; }
  :global(html), :global(body) { background: #fff; color-scheme: light dark; }
  :global(code) { overflow-wrap: anywhere; }
  /* Thème sombre : mêmes jetons sémantiques, redéfinis (sélecteur plus spécifique que
     celui de la feuille partagée, chargée après) ; la chaîne partagée n'est pas modifiée. */
  @media (prefers-color-scheme: dark) {
    :global(html), :global(body) { background: #0e1618; }
    :global(html [data-st-theme]) {
      --st-semantic-surface-default: #0e1618; --st-semantic-surface-raised: #152124; --st-semantic-surface-subtle: #1a2a2e;
      --st-semantic-text-primary: #e7eff1; --st-semantic-text-secondary: #a8bcc1;
      --st-semantic-border-strong: #84a0a7; --st-semantic-border-subtle: #36494e;
      --st-semantic-action-primary: #5cc6d2; --st-semantic-data-category1: #4fb6c2;
      --st-semantic-data-category2: #e3a843; --st-semantic-data-category7: #a88ddb;
      color-scheme: dark;
    }
    :global(html .badge), :global(html button), :global(html .summary-grid article) { background: var(--st-semantic-surface-raised); color: var(--st-semantic-text-primary); }
    :global(html .badge.warning) { border-color: #c98d28; background: #3a2d12; }
    :global(html .badge.selected) { border-color: #3aa56a; background: #12301f; }
    :global(html textarea) { background: var(--st-semantic-surface-default); color: var(--st-semantic-text-primary); }
    :global(html .svelte-flow) {
      --xy-background-pattern-dots-color: #3b5055; --xy-minimap-background-color: #152124;
      --xy-minimap-mask-background-color: rgba(8, 14, 16, .6); --xy-minimap-node-background-color: #2e4449;
      --xy-controls-button-background-color: #1c2b2f; --xy-controls-button-background-color-hover: #26393e;
      --xy-controls-button-color: #e7eff1; --xy-controls-button-color-hover: #fff; --xy-controls-button-border-color: #36494e;
      --xy-edge-label-background-color: #0e1618; --xy-edge-label-color: #e7eff1;
    }
    :global(.svelte-flow__controls-button svg) { fill: currentColor; }
  }
</style>
