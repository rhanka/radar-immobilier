<script>
  // Même contrat d'interaction que Choices.svelte de la chaîne d'architecture
  // (brouillon local, export JSON réel), une réponse par décision D1 à D16 ;
  // l'option recommandée par le dossier est signalée, jamais présélectionnée.
  import { onMount } from 'svelte';
  import { questions, responsePack, minimalValidAnswer } from './choices.js';
  let { manifest } = $props();
  let selections = $state({}), comments = $state({}), status = $state(''), copyError = $state('');
  let storageKey = $derived(`immo-steve-decision-responses:${manifest.artifactInputHash}`);
  let json = $derived(JSON.stringify(responsePack(manifest, selections, comments, null), null, 2));
  const groups = [...new Set(questions.map(question => question.group))];
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
  function pick(question, option) { selections = { ...selections, [question]: option }; persist(); }
  function toggle(question, option) {
    const current = selections[question] ?? [];
    const next = current.includes(option) ? current.filter(value => value !== option) : [...current, option];
    selections = { ...selections, [question]: next };
    persist();
  }
  const checked = (question, option) => question.mode === 'multi'
    ? (selections[question.key] ?? []).includes(option.key)
    : selections[question.key] === option.key;
  function comment(question, value) { comments = { ...comments, [question]: value }; persist(); }
  const packText = () => JSON.stringify(responsePack(manifest, selections, comments, new Date().toISOString()), null, 2);
  async function copy() {
    copyError = '';
    try { await navigator.clipboard.writeText(packText()); status = 'Questions, choix et commentaires réellement copiés en JSON.'; }
    catch { copyError = 'Copie refusée par le navigateur. Le JSON reste sélectionnable et téléchargeable.'; }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([packText()], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'reponses-dossier-retours-steve.json'; a.click(); URL.revokeObjectURL(url);
  }
</script>

<section class="choices" id="ce-qu-on-demande" aria-labelledby="choice-title">
  <div class="flex-row">
    <div><span class="eyebrow">§3 et §10 · décisions demandées à Farid, validation technique par Fabien</span><h2 id="choice-title">Décisions D1 à D16</h2></div>
    <span class="badge warning">Brouillon local · rien n’est ratifié</span>
  </div>
  <p>Chaque décision précède ses options, dans l’ordre du dossier ; l’option recommandée est signalée. Les réponses restent locales : elles ne créent
    aucune migration, aucun import, aucun acte de production, ne fusionnent aucune PR et n’écrivent aucun événement track.</p>
  <p><strong>Réponse minimale valide :</strong> <code>{minimalValidAnswer}</code></p>
  {#each groups as group}
    <section class="question-group" aria-label={group}>
      <h3 class="group-title">{group}</h3>
      {#each questions.filter(question => question.group === group) as question}
        <section class="question-block" data-question={question.key} data-mode={question.mode} aria-labelledby={`question-${question.key}`}>
          <div class="flex-row">
            <h4 id={`question-${question.key}`}>{question.question}</h4>
            <span class="badge" class:warning={question.mode === 'multi'}>{question.mode === 'multi' ? 'plusieurs réponses' : 'une seule réponse'}</span>
          </div>
          <p class="roles" data-decides={question.decides}><span class="badge" class:warning={question.decides === 'Farid'}>Décide : {question.decides}</span> <span class="badge">Consulté : {question.consulted}</span>{#if question.decides === 'Fabien'} <span class="role-note">validation technique</span>{/if}</p>
          <p>{question.context}</p>
          <div class="option-grid" aria-label={`Options pour ${question.question}`}>
            {#each question.options as option}
              <article class="option" data-option={option.key} data-selected={checked(question, option)}>
                <div class="flex-row"><span class="badge">{option.key}</span>{#if option.key === question.recommended}<span class="badge warning">Recommandée</span>{/if}{#if checked(question, option)}<span class="badge selected">Sélectionnée</span>{/if}</div>
                <label>
                  <input type={question.mode === 'multi' ? 'checkbox' : 'radio'} name={question.key} value={option.key}
                    checked={checked(question, option)}
                    onchange={() => question.mode === 'multi' ? toggle(question.key, option.key) : pick(question.key, option.key)} />
                  {option.title}
                </label>
                <p>{option.detail}</p>
              </article>
            {/each}
          </div>
          <label class="comment">Commentaire — {question.question}
            <textarea value={comments[question.key] ?? ''} rows="2" oninput={event => comment(question.key, event.currentTarget.value)}></textarea>
          </label>
        </section>
      {/each}
    </section>
  {/each}
  <div class="flex-row">
    <button onclick={copy}>Copier les réponses en JSON</button>
    <button onclick={download}>Télécharger les réponses en JSON</button>
    <button onclick={() => { selections = {}; comments = {}; persist(); }}>Effacer les réponses</button>
  </div>
  <p role="status">{copyError || status}</p>
  <details class="choice-json" open={Boolean(copyError)}>
    <summary>Voir le JSON réel des questions, options, choix et commentaires</summary>
    <textarea aria-label="JSON des réponses au dossier retours de Steve" readonly value={json} rows={18}></textarea>
  </details>
</section>

<style>
  .choices { margin-block: 36px; padding: 28px; border: 1px solid var(--st-semantic-border-subtle); background: var(--st-semantic-surface-subtle); }
  .group-title { margin: 28px 0 0; font-size: 1.1rem; border-bottom: 3px solid var(--st-semantic-border-strong); padding-bottom: 8px; }
  .question-block { border-top: 1px solid var(--st-semantic-border-subtle); padding-block: 20px; }
  .option-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-block: 16px; }
  .option { padding: 14px; border: 1px solid var(--st-semantic-border-subtle); background: var(--st-semantic-surface-default); }
  .option[data-selected='true'] { border-color: var(--st-semantic-action-primary); border-left-width: 6px; }
  .roles { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin: 8px 0 0; }
  .role-note { font-size: .8rem; color: var(--st-semantic-text-secondary); }
  h2, h4 { margin: 0; } h4 { font-size: 1rem; }
  p { font-size: .9rem; line-height: 1.55; }
  .option label { display: block; margin: 8px 0; font-weight: 650; font-size: .92rem; }
  .comment { display: block; font-size: .8rem; color: var(--st-semantic-text-secondary); }
  .choice-json textarea { width: 100%; margin-top: 14px; font-family: monospace; font-size: .78rem; }
  @media (max-width: 900px) { .option-grid { grid-template-columns: 1fr; } .choices { padding: 18px 14px; } }
</style>
