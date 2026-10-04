<script>
  // Same interaction contract as Choices.svelte in the architecture chain (local draft),
  // one answer per decision D1 to D16; the recommended option is flagged, never preselected.
  // Order of decision: Fabien's block first, then Farid's. Each decision opens with an
  // introduction and its dependencies; each option lists its advantages and drawbacks.
  // Export: a paste-ready Markdown block (```yaml … ```) for the GitHub PR, copied to the
  // clipboard and always shown in a read-only textarea (artifacts may refuse the clipboard
  // and block downloads). The JSON pack (responsePack) stays internal, for the backend.
  import { onMount, tick } from 'svelte';
  import MiniEr from './MiniEr.svelte';
  import { questions, minimalValidAnswer, exportBlock, PEOPLE, DECISIONS_TARGET_URL, DECISIONS_TARGET_LABEL, SEQUENCE, STEPS, usedBy } from './choices.js';
  let { manifest } = $props();
  let selections = $state({}), comments = $state({}), deferred = $state({});
  let person = $state(PEOPLE[0]), scope = $state('mine'), stamp = $state(new Date());
  let status = $state(''), copyError = $state(''), yamlArea = $state();
  let storageKey = $derived(`immo-steve-decision-responses:${manifest.artifactInputHash}`);
  let exported = $derived(exportBlock(manifest, { selections, comments, deferred }, person, scope, stamp));
  const groups = [...new Set(questions.map(question => question.group))];
  const short = Object.fromEntries(questions.map(question => [question.key, question.question.replace(/^D\d+ — /, '').replace(/ \(.*\)$/, '')]));
  const optionTitle = question => question.options.find(option => option.key === question.recommended)?.title;
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
    : (selections[question.key] ?? question.decided?.option) === option.key;
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
    <div><span class="eyebrow">§3 et §10 · Fabien décide d’abord, Farid ensuite</span><h2 id="choice-title">Décisions D1 à D16</h2></div>
    <span class="badge warning">Brouillon local · rien n’est ratifié</span>
  </div>
  <div class="sequence" data-sequence>
    <strong>Ordre de décision.</strong> {SEQUENCE}
    <ol>{#each STEPS as step}<li><strong>{step.label}</strong> : {questions.filter(question => question.step === step.step).map(question => question.key).join(', ')}.</li>{/each}</ol>
  </div>
  <p>Chaque décision s’ouvre sur une courte introduction (le problème, pourquoi maintenant, ce qui change selon le choix, les renvois au dossier),
    dit de quelles décisions elle dépend, puis détaille chaque option avec ses avantages et ses inconvénients ; l’option recommandée est signalée.
    Les réponses restent locales : elles ne créent aucune migration, aucun import, aucun acte de production, ne fusionnent aucune PR et n’écrivent aucun événement track.</p>
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
          {#if question.decided}<p class="decided" data-decided={question.decided.option}><span class="badge selected">Tranchée · actée par l’owner le {question.decided.date}</span> {question.decided.note}</p>{/if}
          <p class="roles" data-decides={question.decides}><span class="badge step" data-step={question.step}>Étape {question.step} · {question.decides} décide</span> <span class="badge">Consulté : {question.consulted}</span>{#if question.decides === 'Fabien'} <span class="role-note">validation technique, prise telle quelle sauf incohérence</span>{:else} <span class="role-note">après les décisions de Fabien</span>{/if}</p>
          <p class="intro" data-intro>{question.intro}</p>
          <p class="deps" data-depends-on={question.dependsOn.join(' ')}>
            <strong>Dépend de :</strong> {#if question.dependsOn.length}{#each question.dependsOn as key, index}{index ? ' · ' : ''}<a href={`#question-${key}`}>{key} {short[key]}</a>{/each}{:else}aucune décision antérieure{/if}
            {#if usedBy[question.key].length}<br><strong>Conditionne :</strong> {usedBy[question.key].map(key => `${key} ${short[key]}`).join(' · ')}{/if}
          </p>
          <div class="option-grid" class:wide={question.options.some(option => option.diagram)} aria-label={`Options pour ${question.question}`}>
            {#each question.options as option}
              <article class="option" data-option={option.key} data-selected={checked(question, option)}>
                <div class="flex-row"><span class="badge">{option.key}</span>{#if option.key === question.recommended}<span class="badge warning">Recommandée</span>{/if}{#if checked(question, option)}<span class="badge selected">Sélectionnée</span>{/if}</div>
                <label>
                  <input type={question.mode === 'multi' ? 'checkbox' : 'radio'} name={question.key} value={option.key}
                    checked={checked(question, option)}
                    onchange={() => question.mode === 'multi' ? toggle(question.key, option.key) : pick(question.key, option.key)} />
                  {option.title}
                </label>
                <p class="description" data-description><span class="pc-title">Description</span><br>{option.description}</p>
                {#if option.diagram}<div class="option-diagram"><MiniEr id={`option-${question.key}-${option.key}`} spec={option.diagram} /></div>{/if}
                <div class="pros-cons">
                  <div><span class="pc-title">Avantages</span><ul data-pros>{#each option.pros as item}<li>{item}</li>{/each}</ul></div>
                  <div><span class="pc-title">Inconvénients</span><ul data-cons>{#each option.cons as item}<li>{item}</li>{/each}</ul></div>
                </div>
              </article>
            {/each}
          </div>
          <p class="recommendation" data-recommendation>{#if question.recommended}<strong>Recommandation : {optionTitle(question)}.</strong>{:else}<strong>Point ouvert.</strong>{/if} {question.recommendation}</p>
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
          <option value="mine">les miennes (je décide ou je valide)</option>
          <option value="all">toutes</option>
        </select>
      </label>
    </div>
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
  .role-note { font-size: .8rem; color: var(--st-semantic-text-secondary); }
  .decided { margin: 8px 0 0; font-size: .9rem; font-weight: 600; }
  .sequence { margin: 16px 0; padding: 14px 16px; border-left: 5px solid var(--st-semantic-data-category2); background: var(--st-semantic-surface-default); font-size: .92rem; line-height: 1.55; }
  .sequence ol { margin: 8px 0 0; padding-left: 20px; }
  .badge.step[data-step='1'] { border-color: var(--st-semantic-data-category1); }
  .badge.step[data-step='2'] { border-color: var(--st-semantic-data-category2); }
  .intro { max-width: 1050px; font-size: .95rem; line-height: 1.6; }
  .deps { font-size: .85rem; color: var(--st-semantic-text-secondary); }
  .deps a { color: var(--st-semantic-action-primary); }
  .option-grid.wide { grid-template-columns: 1fr; }
  .description { margin: 6px 0 10px; font-size: .88rem; line-height: 1.55; }
  .option-diagram { margin: 4px 0 12px; padding: 8px; border: 1px dashed var(--st-semantic-border-subtle); overflow-x: auto; }
  .pros-cons { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .pros-cons ul { margin: 4px 0 0; padding-left: 18px; font-size: .84rem; line-height: 1.5; }
  .pc-title { font-size: .72rem; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--st-semantic-text-secondary); }
  .recommendation { padding: 10px 14px; border-left: 4px solid var(--st-semantic-action-primary); background: var(--st-semantic-surface-default); }
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
  @media (max-width: 900px) { .option-grid, .pros-cons { grid-template-columns: 1fr; } .choices { padding: 18px 14px; } }
</style>
