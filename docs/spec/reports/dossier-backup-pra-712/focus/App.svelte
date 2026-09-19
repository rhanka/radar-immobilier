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
        <span class="eyebrow">#698 · Sauvegardes &amp; PRA d’ensemble · PR #712 + rhanka/geo#390 · v2</span>
        <span class="badge warning">{graphs.length} SCÈNES · {decisionSections.length} SECTIONS · 18 SEPTEMBRE 2026</span>
      </div>
      <h1>Sauvegarder immo et geo,<br>prouver la restauration<br>avant de fusionner.</h1>
      <p class="lede">La PR #712 a été entièrement reprise : provisionnement en une commande, trois identités S3,
        bucket privé, versionné et verrouillable, comptes exacts pris dans la transaction du dump, restauration sur
        instance éphémère, surveillance. La PR geo#390 apporte le volet geo, dont les données irremplaçables se copient
        sans gel. Mais les deux revues contradictoires, Fable 5.1 et Gemini 3.8 high, concluent chacune
        « non fusionnable en l’état » : la recommandation est de corriger avant fusion.</p>
      <div class="truth-strip state-strip">
        <span><strong>Revues : non fusionnable</strong> Fable 5.1 et Gemini 3.8 high</span>
        <span><strong>Provisionnement gelé</strong> en attente de D2 (verrou d’objet)</span>
        <span><strong>Preuve préprod : pas faite</strong> ni sauvegarde, ni restauration</span>
        <span><strong>Mesures geo : pas faites</strong> volumes, débit, délai de reprise</span>
        <span><strong>Aucune fusion · aucune activation</strong> aucune sauvegarde planifiée aujourd’hui</span>
        <span><strong>Recommandation : corriger avant fusion</strong> D1 = A · agrément k8s sous réserves R1 à R7</span>
      </div>
    </header>

    <section class="reading-map" aria-label="Comment lire ce dossier">
      <h2>Comment lire ce dossier</h2>
      <ol>
        <li><strong>L’état réel et la décision</strong> (section 1), ouverte ; puis les 11 autres sections, dépliables.</li>
        <li><strong>Trois scènes</strong> : l’architecture immo + geo, la séquence de bout en bout, la mise en service.</li>
        <li><strong>Les choix de §12</strong> (D1 à D5), sélectionnables, exportables en JSON — brouillon local seulement.</li>
        <li><strong>Les annexes</strong>, verbatim : A les deux revues actuelles, B les deux agréments, C les revues de la première version.</li>
      </ol>
      <p class="caption">Repères sur les cartes : B1–B5 = bloquants Fable, G2–G13 = objections Gemini, I1–I14 = importants Fable,
        R1–R7 = réserves de la lane k8s, D1–D5 = décisions de §12.</p>
    </section>

    <Sections sections={decisionSections.slice(0, 1)} label="Décision demandée et état réel" open={true} />
    <Sections sections={decisionSections.slice(1)} label="Les sections 2 à 12 du dossier" open={false} />
    <Scenes {graphs} />
    <DecisionChoices {manifest} />
    <Sections sections={annexes} label="Annexes verbatim du dossier" open={false} />

    <footer>
      <strong>Preuves embarquées · page autonome hors ligne</strong>
      <p>Trois graphes Mermaid canoniques (annexe D du dossier) rendus en SvelteFlow natif, conteneurs <code>parentId</code>
        réels, gabarit unique A’ 460 × 200 à l’échelle 1, placement Dagre récursif <code>rankdir LR</code> et routeur
        orthogonal du kit h2a — la chaîne de <code>docs/architecture/focus</code>, importée, pas recopiée.
        Empreinte du dossier : <code>{manifest.dossierHash.slice(0, 16)}…</code> ·
        empreinte d’entrée : <code>{manifest.artifactInputHash.slice(0, 16)}…</code>.</p>
      <p>Ouvrir cette page n’exécute rien : aucune fusion de PR, aucun provisionnement, aucun déploiement, aucune sauvegarde
        ni restauration, aucune action cluster ou OVH, aucun événement track.</p>
    </footer>
  </main>
</div>

<style>
  .reading-map { margin-block: 28px; padding: 22px 24px; border: 1px solid var(--st-semantic-border-subtle); background: var(--st-semantic-surface-subtle); }
  .reading-map h2 { margin-top: 0; font-size: 1.3rem; }
  .reading-map ol { margin: 0 0 14px; padding-left: 22px; line-height: 1.7; font-size: .95rem; }
  .state-strip { grid-template-columns: repeat(3, 1fr); }
  @media (max-width: 900px) { .state-strip { grid-template-columns: 1fr; } }
  footer { margin-top: 44px; padding-top: 20px; border-top: 3px solid var(--st-semantic-border-strong); }
</style>
