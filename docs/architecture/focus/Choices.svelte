<script>
  import { onMount } from 'svelte';
  import { questions, responsePack } from './choices.js';
  let { manifest, remarks = '' } = $props();
  let selections = $state({}), comments = $state({}), status = $state(''), copyError = $state('');
  let storageKey = $derived(`immo-focus-d9-responses:${manifest.artifactInputHash}`);
  let json = $derived(JSON.stringify(responsePack(manifest, selections, comments, remarks, null), null, 2));
  onMount(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
      if (saved) { selections = saved.selections ?? {}; comments = saved.comments ?? {}; }
    } catch { status = 'Lecture du brouillon local indisponible.'; }
  });
  function persist() {
    copyError = '';
    try { localStorage.setItem(storageKey, JSON.stringify({ selections, comments })); status = 'Choix et commentaires enregistrés localement — non ratifiés.'; }
    catch { status = 'Sauvegarde locale indisponible : copiez ou téléchargez le JSON.'; }
  }
  function select(question, option) { selections = { ...selections, [question]: option }; persist(); }
  function comment(question, value) { comments = { ...comments, [question]: value }; persist(); }
  const packText = () => JSON.stringify(responsePack(manifest, selections, comments, remarks, new Date().toISOString()), null, 2);
  async function copy() {
    copyError = '';
    try { await navigator.clipboard.writeText(packText()); status = 'Questions, choix et commentaires réellement copiés en JSON.'; }
    catch { copyError = 'Copie refusée par le navigateur. Le JSON reste sélectionnable et téléchargeable.'; }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([packText()], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'immo-reponses-d9.json'; a.click(); URL.revokeObjectURL(url);
  }
</script>

<section class="choices" aria-labelledby="choice-title">
  <h3 id="choice-title">Questions ouvertes au propriétaire</h3>
  <p>Chaque question précède ses options. Les réponses restent des brouillons locaux : elles ne modifient ni les décisions déjà ratifiées, ni Track, ni le déploiement.</p>
  {#each questions as question}
    <section class="question-block" aria-labelledby={`question-${question.key}`}>
      <div class="flex-row">
        <h3 id={`question-${question.key}`}>{question.question}</h3>
        <span class="badge" class:warning={question.criticality === 'architecture'}>{question.criticality === 'non-critical' ? 'Non critique' : question.criticality}</span>
      </div>
      <p>{question.context}</p>
      <div class="option-grid" aria-label={`Options pour ${question.question}`}>
        {#each question.options as option}<article class="option"><div>
          <div class="flex-row"><span class="badge">{option.key}</span>{#if selections[question.key] === option.key}<span class="badge selected">Sélectionnée</span>{/if}</div>
          <h4>{option.title}</h4>
          <label><input type="radio" name={question.key} value={option.key} checked={selections[question.key] === option.key} onchange={() => select(question.key, option.key)} /> Choisir : {option.title}</label>
          <p>{option.detail}</p>
        </div></article>{/each}
      </div>
      <label>Commentaire — {question.question}<textarea value={comments[question.key] ?? ''} rows="3" oninput={event => comment(question.key, event.currentTarget.value)}></textarea></label>
    </section>
  {/each}
  <div class="flex-row"><button onclick={copy}>Copier les réponses en JSON</button><button onclick={download}>Télécharger les réponses en JSON</button><button onclick={() => { selections = {}; comments = {}; persist(); }}>Effacer les réponses</button></div>
  <p role="status">{copyError || status}</p>
  <details class="choice-json" open={Boolean(copyError)}><summary>Voir le JSON réel des questions, options, choix et commentaires</summary><textarea aria-label="JSON des réponses D9" readonly value={json} rows={20}></textarea></details>
</section>
<style>
  .choices { margin-block: 24px; } .question-block { border-top: 1px solid var(--st-semantic-border-subtle); padding-block: 24px; }
  .option-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; margin-block: 20px; }
  .option { padding: 16px; border: 1px solid var(--st-semantic-border-subtle); }
  h3, h4 { margin: 0; } h3 { font-size: 1.15rem; } h4 { font-size: 1rem; } p { font-size: .9rem; line-height: 1.5; }
  .choice-json textarea { width: 100%; margin-top: 16px; font-family: monospace; font-size: .8rem; }
  @media (max-width: 850px) { .option-grid { grid-template-columns: 1fr; } }
</style>
