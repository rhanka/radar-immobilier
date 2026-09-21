<script>
  // Dossier recentré sur l'ÉTAPE 1 : ZÉRO question. Le panneau n'expose plus des
  // choix à trancher, mais le DESIGN STATUÉ (décisions = faits) et les deux étapes.
  // Il reste un enregistrement local exportable, relu par l'owner avant commit.
  import { principe, cible, etape1, pretVsConstruire, etape2, questions, decisionRecord } from './choices.js';
  let { manifest } = $props();
  let status = $state(''), copyError = $state('');
  let json = $derived(JSON.stringify(decisionRecord(manifest, null), null, 2));
  // Contenu entièrement contrôlé ici : on échappe le HTML, puis on rend les
  // `extraits de code` entre accents graves.
  const fmt = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  const recordText = () => JSON.stringify(decisionRecord(manifest, new Date().toISOString()), null, 2);
  async function copy() {
    copyError = '';
    try { await navigator.clipboard.writeText(recordText()); status = 'Design statué réellement copié en JSON.'; }
    catch { copyError = 'Copie refusée par le navigateur. Le JSON reste sélectionnable et téléchargeable.'; }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([recordText()], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'design-statue-dossier-712-backup-pra-etape1.json'; a.click(); URL.revokeObjectURL(url);
  }
</script>

<section class="choices" id="decision-etape-1" aria-labelledby="choice-title" data-questions={questions.length}>
  <div class="flex-row">
    <div><span class="eyebrow">Première vague · design statué</span><h2 id="choice-title">Ce qu’on décide, et ce qu’on reporte</h2></div>
    <span class="badge">0 question · design tranché</span>
  </div>
  <p class="principe" data-principe><strong>{principe.title} —</strong> {principe.body}</p>

  <section class="target" data-cible aria-label={cible.title}>
    <h3>{cible.title}</h3>
    <ol>{#each cible.items as item}<li>{@html fmt(item)}</li>{/each}</ol>
  </section>

  <section class="etape" data-etape="1" aria-label={etape1.title}>
    <h3 class="etape-title">{etape1.title} <span class="badge maintenant">{etape1.tag}</span></h3>
    <p class="caption">Chaque point est une décision statuée (un fait) ou de l’exécution — jamais une question.</p>
    <div class="decision-grid">
      {#each etape1.decisions as decision}
        <article class="decision" data-decision={decision.key}>
          <div class="flex-row"><span class="badge">{decision.key}</span><span class="badge statue">statué</span></div>
          <h4>{decision.title}</h4>
          <p>{@html fmt(decision.detail)}</p>
        </article>
      {/each}
    </div>
    <div class="two-col">
      <div class="ready" data-pret>
        <h4>Prêt</h4>
        <ul>{#each pretVsConstruire.pret as item}<li>{@html fmt(item)}</li>{/each}</ul>
      </div>
      <div class="build" data-construire>
        <h4>À construire</h4>
        <ul>{#each pretVsConstruire.aConstruire as item}<li>{@html fmt(item)}</li>{/each}</ul>
      </div>
    </div>
  </section>

  <section class="etape" data-etape="2" aria-label={etape2.title}>
    <h3 class="etape-title">{etape2.title} <span class="badge warning">{etape2.tag}</span></h3>
    <p class="caption">Listé, pas posé en question : le PRA conforme, hors première vague.</p>
    <ul class="apres">{#each etape2.items as item}<li>{@html fmt(item)}</li>{/each}</ul>
  </section>

  <div class="flex-row">
    <button onclick={copy}>Copier le design statué en JSON</button>
    <button onclick={download}>Télécharger le design statué en JSON</button>
  </div>
  <p role="status">{copyError || status}</p>
  <details class="choice-json" open={Boolean(copyError)}>
    <summary>Voir le JSON réel du design statué (principe, cible, étape 1, étape 2)</summary>
    <textarea aria-label="JSON du design statué de l’étape 1 (backup prod → préprod et restore prod → prod)" readonly value={json} rows={18}></textarea>
  </details>
</section>

<style>
  .choices { margin-block: 36px; padding: 28px; border: 1px solid var(--st-semantic-border-subtle); background: var(--st-semantic-surface-subtle); }
  .principe { font-size: 1.02rem; line-height: 1.6; padding: 14px 16px; border-left: 6px solid var(--st-semantic-action-primary); background: var(--st-semantic-surface-default); }
  .target { margin-block: 22px; padding: 18px 20px; border: 1px solid var(--st-semantic-border-strong); background: var(--st-semantic-surface-default); }
  .target h3 { margin: 0 0 10px; font-size: 1.15rem; }
  .target ol { margin: 0; padding-left: 22px; line-height: 1.6; font-weight: 600; }
  .etape { margin-block: 26px; }
  .etape-title { margin: 0 0 6px; font-size: 1.2rem; border-bottom: 3px solid var(--st-semantic-border-strong); padding-bottom: 8px; }
  .decision-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-block: 14px; }
  .decision { padding: 14px; border: 1px solid var(--st-semantic-border-subtle); border-left: 6px solid var(--st-semantic-action-primary); background: var(--st-semantic-surface-default); }
  .two-col { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 4px; }
  .two-col > div { padding: 12px 14px; border: 1px solid var(--st-semantic-border-subtle); background: var(--st-semantic-surface-default); }
  .apres li { margin-block: 4px; }
  h2, h4 { margin: 0; } h4 { font-size: .98rem; margin-bottom: 6px; }
  p { font-size: .9rem; line-height: 1.55; }
  ul, ol { font-size: .9rem; line-height: 1.55; }
  .badge.statue { background: var(--st-semantic-surface-subtle); }
  .caption { color: var(--st-semantic-text-secondary); font-size: .82rem; margin: 2px 0 8px; }
  .choice-json textarea { width: 100%; margin-top: 14px; font-family: monospace; font-size: .78rem; }
  @media (max-width: 900px) { .decision-grid, .two-col { grid-template-columns: 1fr; } .choices { padding: 18px 14px; } }
</style>
