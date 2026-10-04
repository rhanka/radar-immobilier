<script>
  // Same interaction contract as Choices.svelte in the architecture chain (local draft),
  // one answer per decision D1 to D7; the recommended option is flagged, never preselected.
  // Export: a paste-ready Markdown block (```yaml … ```) for the GitHub PR, copied to the
  // clipboard and always shown in a read-only textarea (artifacts may refuse the clipboard
  // and block downloads). The JSON pack (responsePack) stays internal, for the backend.
  import { onMount, tick } from 'svelte';
  import { marked } from 'marked';
  import DOMPurify from 'dompurify';
  import { questions, minimalValidAnswer, exportBlock, PEOPLE, DECISIONS_TARGET_URL, DECISIONS_TARGET_LABEL } from './choices.js';
  let { manifest, details, intro } = $props();
  // Le détail de chaque décision est le §7 du Markdown, rendu tel quel, assaini.
  const html = source => DOMPurify.sanitize(marked.parse(source, { async: false, gfm: true }));
  let selections = $state({}), comments = $state({}), deferred = $state({});
  let person = $state(PEOPLE[0]), scope = $state('mine'), stamp = $state(new Date());
  let status = $state(''), copyError = $state(''), yamlArea = $state();
  let storageKey = $derived(`immo-villes-ecart-decision-responses:${manifest.artifactInputHash}`);
  let exported = $derived(exportBlock(manifest, { selections, comments, deferred }, person, scope, stamp));
  const groups = [...new Set(questions.map(question => question.group))];
  onMount(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
      if (saved) {
        selections = saved.selections ?? {}; comments = saved.comments ?? {}; deferred = saved.deferred ?? {};
        if (PEOPLE.includes(saved.person)) person = saved.person;
        if (['mine', 'all'].includes(saved.scope)) scope = saved.scope;
      }
    } catch { status = 'Lecture du brouillon local indisponible.'; }
  });
  function persist() {
    copyError = '';
    try { localStorage.setItem(storageKey, JSON.stringify({ selections, comments, deferred, person, scope })); status = 'Choix et commentaires enregistrés localement — non ratifiés.'; }
    catch { status = 'Sauvegarde locale indisponible : copiez le bloc YAML avant de quitter la page.'; }
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
  function defer(question, value) { deferred = { ...deferred, [question]: value }; persist(); }
  async function copy() {
    copyError = '';
    stamp = new Date();
    const { text, records } = exported;
    try {
      if (!navigator.clipboard?.writeText) throw Error('clipboard unavailable');
      await navigator.clipboard.writeText(text);
      status = `${records.length} décision(s) copiée(s) en YAML. Ouvrez la PR et collez-les dans un commentaire.`;
    } catch {
      copyError = 'Copie refusée par le navigateur (fréquent dans un artefact publié). Le bloc YAML ci-dessous est sélectionné : copiez-le avec Ctrl+C (Cmd+C sur Mac), puis collez-le dans un commentaire de la PR.';
      await tick();
      yamlArea?.focus();
      yamlArea?.select();
    }
  }
</script>

<section class="choices" id="ce-qu-on-demande" aria-labelledby="choice-title">
  <div class="flex-row">
    <div><span class="eyebrow">§3.1 et §7 · décisions demandées à Fabien, Farid consulté sur D2 et D3</span><h2 id="choice-title">Décisions D1 à D7</h2></div>
    <span class="badge warning">Brouillon local · rien n’est ratifié</span>
  </div>
  <div class="prose intro">{@html html(intro)}</div>
  <p>Chaque décision donne son problème, ses options avec avantages et inconvénients, puis la recommandation ; l’option recommandée est signalée, jamais présélectionnée. Les réponses restent locales : elles ne lancent
    aucune réparation, aucun job, n’écrivent dans aucun cluster, bucket ou base, ne fusionnent aucune PR et n’écrivent aucun événement track.</p>
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
          <p class="roles" data-decides={question.decides}><span class="badge warning">Décide : {question.decides}</span> <span class="badge">{question.consulted.includes('informé') ? question.consulted : `Consulté : ${question.consulted}`}</span></p>
          <details class="decision-detail" open data-detail={question.key}><summary>Problème, options avantages et inconvénients, recommandation (§7)</summary><div class="prose">{@html html(details[question.key].markdown)}</div></details>
          <p class="context"><strong>{question.context}</strong></p>
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
          <label class="defer"><input type="checkbox" data-defer checked={Boolean(deferred[question.key])}
            onchange={event => defer(question.key, event.currentTarget.checked)} /> Différer cette décision (statut « différée » dans l’export)</label>
          <label class="comment">Commentaire — {question.question}
            <textarea value={comments[question.key] ?? ''} rows="2" oninput={event => comment(question.key, event.currentTarget.value)}></textarea>
          </label>
        </section>
      {/each}
    </section>
  {/each}

  <section class="export" aria-labelledby="export-title">
    <h3 id="export-title" class="group-title">Copier mes décisions dans GitHub</h3>
    <p class="steps-line"><strong>1.</strong> Copier, <strong>2.</strong> ouvrir la PR, <strong>3.</strong> coller dans un commentaire.</p>
    <div class="flex-row export-controls">
      <label>Je suis
        <select data-export-person value={person} onchange={event => { person = event.currentTarget.value; persist(); }}>
          {#each PEOPLE as name}<option value={name}>{name}</option>{/each}
        </select>
      </label>
      <label>Décisions copiées
        <select data-export-scope value={scope} onchange={event => { scope = event.currentTarget.value; persist(); }}>
          <option value="mine">les miennes (je décide)</option>
          <option value="all">toutes</option>
        </select>
      </label>
    </div>
    {#if !exported.records.length}<p class="caption" data-export-empty>Aucune décision à votre nom : Farid est consulté (D2, D3) ou informé. Choisissez « toutes » pour copier les sept décisions avec vos commentaires.</p>{/if}
    <div class="flex-row export-actions">
      <button data-export-copy onclick={copy}>Copier mes décisions (YAML)</button>
      <a class="target-link" data-export-target href={DECISIONS_TARGET_URL} target="_blank" rel="noopener">{DECISIONS_TARGET_LABEL}</a>
      <button onclick={() => { selections = {}; comments = {}; deferred = {}; persist(); }}>Effacer les réponses</button>
    </div>
    <p role="status" class:copy-error={Boolean(copyError)}>{copyError || status}</p>
    <label class="yaml-label" for="decisions-yaml">Bloc à coller (Markdown, YAML) · {exported.records.length} décision(s) · sélectionnable si la copie est refusée</label>
    <textarea id="decisions-yaml" class="decisions-yaml" bind:this={yamlArea} readonly value={exported.text} rows="16"
      onfocus={event => event.currentTarget.select()}></textarea>
  </section>
</section>

<style>
  .choices { margin-block: 36px; padding: 28px; border: 1px solid var(--st-semantic-border-subtle); background: var(--st-semantic-surface-subtle); }
  .group-title { margin: 28px 0 0; font-size: 1.1rem; border-bottom: 3px solid var(--st-semantic-border-strong); padding-bottom: 8px; }
  .question-block { border-top: 1px solid var(--st-semantic-border-subtle); padding-block: 20px; }
  .option-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-block: 16px; }
  .option { padding: 14px; border: 1px solid var(--st-semantic-border-subtle); background: var(--st-semantic-surface-default); }
  .option[data-selected='true'] { border-color: var(--st-semantic-action-primary); border-left-width: 6px; }
  .roles { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin: 8px 0 0; }
  .decision-detail { margin: 12px 0 0; font-size: .9rem; }
  .decision-detail summary { cursor: pointer; font-weight: 650; }
  .decision-detail .prose :global(strong:first-child) { display: inline; }
  .intro { font-size: .9rem; }
  h2, h4 { margin: 0; } h4 { font-size: 1rem; }
  p { font-size: .9rem; line-height: 1.55; }
  .option label { display: block; margin: 8px 0; font-weight: 650; font-size: .92rem; }
  .defer { display: block; margin-bottom: 10px; font-size: .85rem; }
  .comment { display: block; font-size: .8rem; color: var(--st-semantic-text-secondary); }
  .export-controls, .export-actions { justify-content: flex-start; flex-wrap: wrap; gap: 16px; align-items: flex-end; }
  .export-controls label { display: flex; flex-direction: column; gap: 4px; font-size: .85rem; }
  .export-controls select { padding: 6px 8px; }
  .export-actions { align-items: center; margin-top: 14px; }
  .target-link { color: var(--st-semantic-action-primary); font-weight: 650; }
  .copy-error { border-left: 4px solid var(--st-semantic-action-primary); padding-left: 10px; font-weight: 650; }
  .yaml-label { display: block; margin-top: 12px; font-size: .8rem; color: var(--st-semantic-text-secondary); }
  .decisions-yaml { width: 100%; font-family: monospace; font-size: .78rem; white-space: pre; overflow: auto; }
  @media (max-width: 900px) { .option-grid { grid-template-columns: 1fr; } .choices { padding: 18px 14px; } }
</style>
