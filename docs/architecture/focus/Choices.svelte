<script>
  import { onMount } from 'svelte';
  import { Badge, Button, Flex, Radio, Stack, Textarea, Tile } from '@sentropic/design-system-svelte';
  import { questions, responsePack } from './choices.js';
  let { manifest, remarks = '' } = $props();
  let selections = $state({}), comments = $state({}), status = $state(''), copyError = $state('');
  let storageKey = $derived(`immo-focus-d7-responses:${manifest.artifactInputHash}`);
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
    const a = document.createElement('a'); a.href = url; a.download = 'immo-reponses-d7.json'; a.click(); URL.revokeObjectURL(url);
  }
</script>

<section class="choices" aria-labelledby="choice-title">
  <h3 id="choice-title">Questions ouvertes au propriétaire</h3>
  <p>Chaque question précède ses options. Les réponses restent des brouillons locaux : elles ne modifient ni les décisions déjà ratifiées, ni Track, ni le déploiement.</p>
  {#each questions as question}
    <section class="question-block" aria-labelledby={`question-${question.key}`}>
      <Flex justify="between" align="start" wrap gap={2}>
        <h3 id={`question-${question.key}`}>{question.question}</h3>
        <Badge tone={question.criticality === 'architecture' ? 'warning' : 'neutral'}>{question.criticality === 'non-critical' ? 'Non critique' : question.criticality}</Badge>
      </Flex>
      <p>{question.context}</p>
      <div class="option-grid" aria-label={`Options pour ${question.question}`}>
        {#each question.options as option}<Tile><Stack gap={3}>
          <Flex justify="between" wrap gap={2}><Badge tone="neutral">{option.key}</Badge>{#if selections[question.key] === option.key}<Badge tone="success">Sélectionnée</Badge>{/if}</Flex>
          <h4>{option.title}</h4>
          <Radio name={question.key} value={option.key} label={`Choisir : ${option.title}`} checked={selections[question.key] === option.key} onchange={() => select(question.key, option.key)} />
          <p>{option.detail}</p>
        </Stack></Tile>{/each}
      </div>
      <Textarea label={`Commentaire — ${question.question}`} helperText="Inclus avec ce choix dans le JSON local." value={comments[question.key] ?? ''} rows={3} oninput={event => comment(question.key, event.currentTarget.value)} />
    </section>
  {/each}
  <Flex gap={2} wrap><Button variant="primary" onclick={copy}>Copier les réponses en JSON</Button><Button variant="secondary" onclick={download}>Télécharger les réponses en JSON</Button><Button variant="ghost" onclick={() => { selections = {}; comments = {}; persist(); }}>Effacer les réponses</Button></Flex>
  <p role="status">{copyError || status}</p>
  <details class="choice-json" open={Boolean(copyError)}><summary>Voir le JSON réel des questions, options, choix et commentaires</summary><textarea aria-label="JSON des réponses D7" readonly value={json} rows={20}></textarea></details>
</section>
<style>
  .choices { margin-block: 24px; } .question-block { border-top: 1px solid var(--st-semantic-border-subtle); padding-block: 24px; }
  .option-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; margin-block: 20px; }
  h3, h4 { margin: 0; } h3 { font-size: 1.15rem; } h4 { font-size: 1rem; } p { font-size: .9rem; line-height: 1.5; }
  .choice-json textarea { width: 100%; margin-top: 16px; font-family: monospace; font-size: .8rem; }
  @media (max-width: 850px) { .option-grid { grid-template-columns: 1fr; } }
</style>
