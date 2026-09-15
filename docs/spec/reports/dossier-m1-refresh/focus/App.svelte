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
        <span class="eyebrow">Dossier de décision M1 (v3) · quel modèle pour le CronJob radar-refresh-pv</span>
        <span class="badge warning">2 SCÈNES · 7 SECTIONS · 14 SEPTEMBRE 2026</span>
      </div>
      <h1>Une décision :<br>ce qu’on fait des 13 %<br>de PV refusés.</h1>
      <p class="lede">Sur 100 procès-verbaux de 100 villes, Gemini 3.8 Flash LOW sous contrat v9 <code>93994e45</code>
        fait passer 87 documents à travers les six couches de validation, ancre 98,49 % de ses citations, ne sature
        jamais le plafond de 64 000 tokens et répond en 19,2 s de moyenne. Le modèle n’est plus l’inconnue.
        L’inconnue est le sort des 13 documents refusés — dont neuf sur treize tiennent à un seul enregistrement fautif.</p>
      <div class="truth-strip">
        <span><strong>87 / 100</strong> acceptés · IC 95 % [79 ; 92]</span>
        <span><strong>98,49 %</strong> citations ancrées · 2 087 / 2 119</span>
        <span><strong>13 REFUS</strong> 3 classes · 9 pour un enregistrement</span>
        <span><strong>17 424 TOKENS</strong> sortie maximale · plafond 64 000</span>
        <span><strong>JUGES</strong> 2,96 / 3,60 · κ −0,018</span>
      </div>
    </header>

    <section class="reading-map" aria-label="Comment lire ce dossier">
      <h2>Comment lire ce dossier</h2>
      <ol>
        <li><strong>Les 7 sections</strong> du dossier, dépliables, dans leur texte d’origine.</li>
        <li><strong>Deux scènes</strong> : la chaîne de mesure, puis les résultats v4 → v100 et les quatre options.</li>
        <li><strong>Le choix de §7</strong>, sélectionnable, exportable en JSON — brouillon local seulement.</li>
        <li><strong>L’annexe</strong> : le glossaire, verbatim.</li>
      </ol>
      <p class="caption">Convention du dossier : <code>[FAIT]</code> = mesuré avec sa source · <code>[JUGEMENT]</code> =
        appréciation du présentateur · <code>N-A</code> = non disponible ou non calculable ·
        <code>source-gap</code> = aucune source dans le dépôt.</p>
    </section>

    <Sections sections={decisionSections} label="Les sept sections du dossier" open={false} />
    <Scenes {graphs} />
    <DecisionChoices {manifest} />
    <Sections sections={annexes} label="Annexe du dossier" open={false} />

    <footer>
      <strong>Preuves embarquées · page autonome hors ligne</strong>
      <p>Deux graphes Mermaid canoniques rendus en SvelteFlow natif, conteneurs <code>parentId</code> réels,
        gabarit unique A’ 460 × 200 à l’échelle 1, placement Dagre récursif <code>rankdir LR</code> et routeur
        orthogonal du kit h2a — la chaîne de <code>docs/architecture/focus</code>, importée, pas recopiée.
        Empreinte du dossier : <code>{manifest.dossierHash.slice(0, 16)}…</code> ·
        empreinte d’entrée : <code>{manifest.artifactInputHash.slice(0, 16)}…</code>.</p>
      <p>Ouvrir cette page n’exécute rien : aucun appel de modèle, aucune campagne, aucune fusion de PR,
        aucune modification de contrat, de prompt, de schéma ou de validateur, aucun événement track.</p>
    </footer>
  </main>
</div>

<style>
  .reading-map { margin-block: 28px; padding: 22px 24px; border: 1px solid var(--st-semantic-border-subtle); background: var(--st-semantic-surface-subtle); }
  .reading-map h2 { margin-top: 0; font-size: 1.3rem; }
  .reading-map ol { margin: 0 0 14px; padding-left: 22px; line-height: 1.7; font-size: .95rem; }
  footer { margin-top: 44px; padding-top: 20px; border-top: 3px solid var(--st-semantic-border-strong); }
</style>
