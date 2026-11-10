<script>
  import Scenes from './Scenes.svelte';
  import Sections from './Sections.svelte';
  import DecisionChoices from './DecisionChoices.svelte';
  import { graphs, header, decisionSections, annexes, manifest } from './.generated/data.json';
  const [intention, recipients, synthesis, ...body] = decisionSections;
  const consensus = annexes.filter(annex => annex.heading.startsWith('Annexe A'));
</script>

<div data-st-theme="entropic">
  <main class="dossier">
    <header class="masthead">
      <div class="flex-row">
        <span class="eyebrow">Dossier de décision · pour Farid (Product Owner) et Fabien (AI Builder, owner) · proposition</span>
        <span class="badge warning">5 SCÈNES · 12 SECTIONS · 18 DÉCISIONS · 3 OCTOBRE 2026</span>
      </div>
      <h1>Rôles et droits de décision<br>dans radar-immobilier</h1>
      <p class="subtitle">Application du modèle de rôles humains issu du quorum h2a</p>
      <p class="lede">Le quorum h2a (Astra, Fable, Gemini, deux rondes) a établi un modèle : six rôles h2a intacts, des humains décideurs sans rôle protocolaire,
        des droits attachés à des fonctions et à des domaines de décision, des validations nommées sur critères, une réserve humaine. Ce dossier l'applique à
        radar-immobilier sans présumer des quatorze décisions h2a encore ouvertes : Fabien seul PRINCIPAL du dépôt ; Farid, Mathieu et Steve humains décideurs
        déclarés dans un profil ; une matrice décide / valide / consulté / informé par type de décision ; un bloc « qui décide » dans chaque dossier, chaque
        question, Track, les cartes et le board. Sept décisions reviennent à Farid, onze à Fabien ; quatre fiches sont portées à Steve, jamais tranchées à sa place. Version r1 : relue contradictoirement par Astra (gpt-6-astra), quinze constats factuels corrigés, Fable rallié à Astra sur D7 (orientation : dernier mot unknown) et D8 (urgence préautorisée), positions r0 conservées en options nommées.</p>
      <div class="truth-strip">
        <span><strong>1 PRINCIPAL</strong> Fabien · repo:radar-immobilier</span>
        <span><strong>3 HUMAINS</strong> sans rôle h2a · Farid, Mathieu, Steve</span>
        <span><strong>17 LIGNES</strong> D · V · C · I · H · délégable</span>
        <span><strong>1048 / 1048</strong> événements Track relayés par Fabien</span>
        <span><strong>2 BRANCHES</strong> D10 h2a · même affectation</span>
        <span><strong>4 FICHES</strong> portées à Steve · unknown</span>
        <span><strong>R1</strong> relu par Astra · 15 faits corrigés · D7, D8 ralliés</span>
      </div>
    </header>

    <section class="reading-map" aria-label="Comment lire ce dossier">
      <h2>Comment lire ce dossier</h2>
      <ol>
        <li><strong>D'abord l'intention de l'owner, les destinataires et la synthèse</strong>, dépliées : le cadre fixé par l'owner (§1.1), qui décide quoi (§2), les 18 décisions et les deux tableaux « Décisions de Farid » et « Décisions de Fabien » (§3).</li>
        <li><strong>Les neuf autres sections</strong>, repliées : ce que le quorum a établi et ce qui reste ouvert côté h2a (§4), l'affectation et les deux branches de D10 (§5), la matrice (§6), les règles de validation PO et AI Builder (§7), la règle de présentation « qui décide » (§8), la comparaison immo / geo (§9), les options (§10), les risques (§11), le plan (§12).</li>
        <li><strong>Cinq scènes</strong> : rôles et périmètres, matrice décide / valide, circuit de validation PO puis AI Builder, les deux branches de D10, immo et geo côte à côte.</li>
        <li><strong>Les décisions D1 à D18</strong> — Farid décide 7, Fabien 11 ; chacune porte « Décide : … · Consulté : … » et sa validation croisée —, sélectionnables, à copier en YAML dans la PR GitHub — brouillon local seulement.</li>
        <li><strong>L'annexe A</strong> : le tableau de consensus Fable / Astra — faits F01-F15, matrice et règles, décisions D1-D18, manques, désaccords restants.</li>
      </ol>
      <p class="caption">Conventions : <code>FAIT</code> = constaté dans une source citée · <code>CADRE</code> = fixé par l'owner · <code>JUGEMENT</code> = appréciation ·
        <code>non vérifié</code>, <code>unknown</code>, <code>source manquante</code>, <code>N-A</code> = limites déclarées. Lettres : D décide · V valide · C consulté · I informé · R prépare ou exécute · H réserve humaine.</p>
    </section>

    <Sections sections={[header]} label="En-tête du dossier" open={false} />
    <Sections sections={[intention, recipients]} label="Intention du dossier et destinataires" open={true} />
    <Sections sections={[synthesis]} label="Synthèse et décisions demandées" open={true} />
    <Sections sections={body} label="Les sections du dossier" open={false} />
    <Scenes {graphs} />
    <DecisionChoices {manifest} />
    <Sections sections={consensus} label="Annexe A — consensus Fable / Astra" open={false} />

    <footer>
      <strong>Preuves embarquées · page autonome hors ligne</strong>
      <p>Cinq graphes Mermaid canoniques rendus en SvelteFlow natif, conteneurs <code>parentId</code> réels,
        gabarit unique A’ 460 × 200 à l’échelle 1, placement Dagre récursif <code>rankdir LR</code> et routeur
        orthogonal du kit h2a — la chaîne de <code>docs/architecture/focus</code>, importée, pas recopiée.
        Empreinte du dossier : <code>{manifest.dossierHash.slice(0, 16)}…</code> ·
        empreinte d’entrée : <code>{manifest.artifactInputHash.slice(0, 16)}…</code>.</p>
      <p>Ouvrir cette page n’exécute rien : aucune règle écrite dans le dépôt, aucun droit accordé, aucun appel de modèle, aucune fusion de PR,
        aucune action de production ou de cluster, aucun événement track.</p>
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
</style>
