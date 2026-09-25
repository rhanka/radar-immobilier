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
        <span class="eyebrow">#698 · Sauvegardes &amp; PRA d’ensemble · PR #712 + rhanka/geo#390 · v3</span>
        <span class="badge warning">{graphs.length} SCÈNES · {decisionSections.length} SECTIONS · ÉTAPE 1 · 0 QUESTION</span>
      </div>
      <h1>Première vague :<br>sauvegarder la prod,<br>reconstruire la préprod.</h1>
      <p class="lede"><strong>Principe :</strong> la préproduction ne se sauvegarde pas. On sauvegarde la
        <strong>production seule</strong> ; la préprod est <strong>reconstruite depuis la prod</strong> — préprod iso-prod,
        pour tester avant de passer en prod. <strong>La cible de la semaine :</strong> backup prod → préprod en place
        (DB + docs, <code>runs/</code> inclus), et restore prod → prod full automatisé, RTO borné (&lt; 2 h). Le design est
        tranché : <strong>zéro question</strong>. Ce qui reste, ce sont des actes (provisionner les creds : lane k8s) et de
        l’exécution. Le PRA conforme — verrou d’objet, RPO 24 h, hors-région — est la prochaine carte (étape 2).</p>
      <div class="truth-strip state-strip">
        <span><strong>Principe : on sauvegarde la prod seule</strong> la préprod se reconstruit depuis la prod (iso-prod)</span>
        <span><strong>Cible : prod → préprod en place</strong> DB + docs, <code>runs/</code> inclus</span>
        <span><strong>Et restore prod → prod automatisé</strong> RTO borné, cible &lt; 2 h</span>
        <span><strong>Serving = immo, repoint 1 → 0</strong> geo n’a rien à date ; le repoint préprod à 1 était une erreur</span>
        <span><strong>Scripts natifs immo, en CI, rejouables sans IA</strong> autonomie immo (OPS-3), aucune orchestration externe</span>
        <span><strong>Creds par la lane k8s · image radar-backup à builder</strong> toolkit 698 réutilisé ; provisioning pas par l’owner</span>
      </div>
    </header>

    <section class="reading-map" aria-label="Comment lire ce dossier">
      <h2>Comment lire ce dossier</h2>
      <ol>
        <li><strong>L’état réel et la décision</strong> (section 1), ouverte ; puis les 12 autres sections, dépliables — le dossier v3 complet, en réserve.</li>
        <li><strong>Trois scènes</strong> : l’architecture immo + geo, la séquence de bout en bout, la mise en service.</li>
        <li><strong>Le design statué de l’étape 1</strong> : deux étapes nettes — « ce qu’on fait maintenant » (backup prod → préprod, restore prod → prod, flip repoint → 0) et « ce qu’il faudra faire après » (PRA conforme). Zéro question ; l’enregistrement s’exporte en JSON.</li>
        <li><strong>Les annexes</strong>, verbatim : A les deux revues actuelles, B les deux agréments, C les revues de la première version.</li>
      </ol>
      <p class="caption">Repères sur les cartes : B1–B5 = bloquants Fable, G2–G13 = objections Gemini, I1–I14 = importants Fable,
        R1–R7 = réserves de la lane k8s. Les sections 2 à 13 gardent le détail v3 ; le haut de page porte la première vague.</p>
    </section>

    <Sections sections={decisionSections.slice(0, 1)} label="Décision demandée et état réel" open={true} />
    <Sections sections={decisionSections.slice(1)} label="Les sections 2 à 12 du dossier" open={false} />
    <Scenes {graphs} {manifest} />
    <DecisionChoices {manifest} />
    <Sections sections={annexes} label="Annexes verbatim du dossier" open={false} />

    <footer>
      <strong>Preuves embarquées · page autonome hors ligne</strong>
      <p>Trois graphes Mermaid canoniques (annexe D du dossier), une seule description, un rendu : SvelteFlow natif
        placé par ELK (conteneurs <code>parentId</code> réels, gabarit unique A’ 460 × 200 de <code>docs/architecture/focus</code>,
        importé, pas recopié), calculé au build. Le rendu Graphviz <code>dot</code> a été supprimé du dossier (ARCH-7).
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
