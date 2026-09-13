<script>
  import { onMount } from 'svelte';
  import { Badge, Button, Flex, Radio, Stack, Textarea, Tile } from '@sentropic/design-system-svelte';
  import { options, responsePack } from './choices.js';
  let { manifest, remarks = '' } = $props();
  let selectedOption = $state(null), note = $state(''), status = $state(''), copyError = $state('');
  const storageKey = `immo-focus-choices:${manifest.artifactInputHash}`;
  let json = $derived(JSON.stringify(responsePack(manifest, selectedOption, note, remarks, null), null, 2));
  onMount(() => {
    try { const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
      if (saved && (saved.option === null || options.some(o => o.key === saved.option))) { selectedOption = saved.option; note = typeof saved.note === 'string' ? saved.note : ''; }
    } catch { status = 'Lecture du brouillon local indisponible.'; }
  });
  function persist() {
    copyError = '';
    try { localStorage.setItem(storageKey, JSON.stringify({ option: selectedOption, note })); status = 'Choix et commentaire enregistrés localement — non ratifiés.'; }
    catch { status = 'Sauvegarde locale indisponible : copiez ou téléchargez le JSON.'; }
  }
  const packText = () => JSON.stringify(responsePack(manifest, selectedOption, note, remarks, new Date().toISOString()), null, 2);
  async function copy() {
    copyError = '';
    try { await navigator.clipboard.writeText(packText()); status = 'Choix et commentaire copiés en JSON.'; }
    catch { copyError = 'Copie refusée par le navigateur. Le JSON reste sélectionnable ci-dessous et téléchargeable.'; }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([packText()], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'immo-choix-commentaires.json'; a.click(); URL.revokeObjectURL(url);
  }
</script>
<section class="choices" aria-labelledby="choice-title">
  <h3 id="choice-title">Votre choix de parcours</h3>
  <p>Choisissez A, B ou C et ajoutez vos réserves. Dossier incomplet : ce brouillon ne vaut ni ratification ni autorisation de travaux.</p>
  <div class="option-grid" aria-label="Options de la décision refresh-sequence">
    {#each options as option}<Tile><Stack gap={3}>
      <Flex justify="between" wrap gap={2}><Badge tone="neutral">Option {option.key}</Badge>{#if selectedOption === option.key}<Badge tone="success">Sélectionnée</Badge>{/if}</Flex>
      <h3>{option.title}</h3>
      <Radio name="refresh-sequence" value={option.key} label={`Choisir l’option ${option.key}`} checked={selectedOption === option.key} onchange={() => { selectedOption = option.key; persist(); }} />
      <p>{option.choice}</p>
      <dl>{#each [['Forces', 'strengths'], ['Contreparties', 'tradeoffs'], ['Coût / risque', 'costRisk'], ['Réversibilité', 'reversibility'], ['Gagne si…', 'winsIf']] as [title, key]}<div><dt>{title}</dt><dd>{option[key]}</dd></div>{/each}</dl>
    </Stack></Tile>{/each}
  </div>
  <Textarea label="Commentaire sur le choix de parcours" helperText="Réserve, condition ou justification incluse dans le JSON." value={note} rows={4} oninput={event => { note = event.currentTarget.value; persist(); }} />
  <Flex gap={2} wrap><Button variant="primary" onclick={copy}>Copier les choix en JSON</Button><Button variant="secondary" onclick={download}>Télécharger les choix en JSON</Button><Button variant="ghost" onclick={() => { selectedOption = null; persist(); }}>Retirer le choix</Button></Flex>
  <p role="status">{copyError || status}</p>
  <details class="choice-json" open={Boolean(copyError)}><summary>Voir le JSON des options, du choix et du commentaire</summary><pre tabindex="0">{json}</pre></details>
</section>
<style>
  .choices { margin-block: 24px; }
  .option-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; margin-block: 20px; }
  h3 { margin: 0; font-size: 1.15rem; } p, dl { font-size: .9rem; line-height: 1.5; }
  dl { margin: 0; } dl > div { margin-bottom: 12px; } dt { font-weight: 700; } dd { margin: 4px 0 0; }
  @media (max-width: 850px) { .option-grid { grid-template-columns: 1fr; } }
</style>
