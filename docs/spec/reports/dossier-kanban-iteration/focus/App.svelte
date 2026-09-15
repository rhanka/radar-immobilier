<script>
  import Scenes from './Scenes.svelte';
  import Sections from './Sections.svelte';
  import DecisionChoices from './DecisionChoices.svelte';
  import { graphs, decisionSections, annexes, manifest } from './.generated/data.json';
</script>

<div data-st-theme="entropic">
  <main class="dossier">
    <header class="masthead">
      <div class="flex-row">
        <span class="eyebrow">Dossier de décision · Kanban GitHub et itération de 15 jours</span>
        <span class="badge warning">2 SCÈNES · 7 SECTIONS · 14 SEPTEMBRE 2026</span>
      </div>
      <h1>Deux décisions :<br>comment on travaille,<br>et ce qu’on fait en 15 jours.</h1>
      <p class="lede">Q1 fixe le way of working au-dessus de track : les 8 colonnes demandées par l’owner, plus la
        valeur terminale qu’impose l’automatisation de fermeture. Q2 fixe le contenu de l’itération du 15 au
        29 septembre, dont l’objectif est la bascule prod. Rien n’a été créé sur GitHub : le jeton courant n’a
        pas le scope <code>project</code>, et aucune commande de §5 n’a été exécutée.</p>
      <div class="truth-strip">
        <span><strong>45 CANDIDATS</strong> owner 8 · 12 août 8 · track 12 · dettes 17</span>
        <span><strong>9 ITEMS</strong> recommandés, 16 h owner</span>
        <span><strong>18 + 2</strong> issues à créer ou adopter</span>
        <span><strong>2 AUTOMATISATIONS</strong> intégrées réellement utiles</span>
        <span><strong>VERDICT RELECTURE</strong> DIVERGE · B ou D, 4 items</span>
      </div>
    </header>

    <section class="reading-map" aria-label="Comment lire ce dossier">
      <h2>Comment lire ce dossier</h2>
      <ol>
        <li><strong>Les 7 sections</strong> du dossier, dépliables, dans leur texte d’origine.</li>
        <li><strong>Deux scènes</strong> : le way of working, puis l’itération de 15 jours.</li>
        <li><strong>Les choix de §7</strong>, sélectionnables, exportables en JSON — brouillon local seulement.</li>
        <li><strong>Les annexes</strong> : les 45 candidats et la relecture indépendante, verbatim.</li>
      </ol>
      <p class="caption">Convention du dossier : <code>[FAIT]</code> = mesuré avec sa source · <code>[JUGEMENT]</code> =
        appréciation du présentateur · <code>N-A</code> = non disponible · <code>source-gap</code> = aucune source ·
        <code>non-vérifié</code> = affirmé par un document, non re-mesuré.</p>
    </section>

    <Sections sections={decisionSections} label="Les sept sections du dossier" open={false} />
    <Scenes {graphs} />
    <DecisionChoices {manifest} />
    <Sections sections={annexes} label="Annexes du dossier" open={false} />

    <footer>
      <strong>Preuves embarquées · page autonome hors ligne</strong>
      <p>Deux graphes Mermaid canoniques rendus en SvelteFlow natif, conteneurs <code>parentId</code> réels,
        gabarit unique A’ 460 × 200 à l’échelle 1, placement Dagre récursif <code>rankdir LR</code> et routeur
        orthogonal du kit h2a — la chaîne de <code>docs/architecture/focus</code>, importée, pas recopiée.
        Empreinte du dossier : <code>{manifest.dossierHash.slice(0, 16)}…</code> ·
        empreinte d’entrée : <code>{manifest.artifactInputHash.slice(0, 16)}…</code>.</p>
      <p>Ouvrir cette page n’exécute rien, ne crée aucune issue, aucun projet GitHub et aucun événement track.</p>
    </footer>
  </main>
</div>

<style>
  .reading-map { margin-block: 28px; padding: 22px 24px; border: 1px solid var(--st-semantic-border-subtle); background: var(--st-semantic-surface-subtle); }
  .reading-map h2 { margin-top: 0; font-size: 1.3rem; }
  .reading-map ol { margin: 0 0 14px; padding-left: 22px; line-height: 1.7; font-size: .95rem; }
  footer { margin-top: 44px; padding-top: 20px; border-top: 3px solid var(--st-semantic-border-strong); }
</style>
