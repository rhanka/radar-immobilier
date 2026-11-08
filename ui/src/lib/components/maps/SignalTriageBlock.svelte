<script lang="ts">
  export let signalId: string;
  /** Catalogue de motifs par verdict ; défaut = codes de démonstration (source-gap : catalogue réel non servi sur main). */
  export let reasonCatalog: Array<{ code: string; verdict: Verdict; label?: string }> = [
    { code: "P-VILLE-TERRITOIRE", verdict: "pertinent" },
    { code: "N-NON-RES", verdict: "non_pertinent" },
  ];

  type Verdict = "pertinent" | "a_surveiller" | "non_pertinent";
  type Choice = Verdict | "non_trie";
  const NAMES: Record<Choice, string> = {
    non_trie: "Non trié",
    pertinent: "Pertinent",
    a_surveiller: "À surveiller",
    non_pertinent: "Écarter",
  };

  // Enregistré = état local de maquette (aucune écriture : pas de chemin gouverné de triage sur main).
  let saved: { choice: Choice; code: string } = { choice: "non_trie", code: "" };
  let draft: Choice = "non_trie";
  let code = "";

  $: codes = draft === "non_trie" ? [] : reasonCatalog.filter((r) => r.verdict === draft);
  $: if (code && !codes.some((r) => r.code === code)) code = "";
  $: dirty = draft !== saved.choice || code !== saved.code;
  $: canSave = dirty && (draft !== "non_pertinent" || code !== "");
  $: savedText =
    saved.choice === "non_trie"
      ? "Non trié"
      : `${NAMES[saved.choice]} · ${saved.code || "sans code"}`;
  $: needsTwoSteps =
    (saved.choice === "pertinent" && draft === "a_surveiller") ||
    (saved.choice === "a_surveiller" && draft === "pertinent");
  $: plan = needsTwoSteps
    ? `Passer à ${NAMES[draft]} : 1) retirer de ${NAMES[saved.choice]}, 2) ajouter à ${NAMES[draft]} — 2 confirmations`
    : "";

  function choose(c: Choice): void {
    draft = c;
    code = c === saved.choice ? saved.code : "";
  }
  function save(): void {
    if (!canSave) return;
    saved = { choice: draft, code };
  }
  function clear(): void {
    saved = { choice: "non_trie", code: "" };
    draft = "non_trie";
    code = "";
  }
</script>

<div class="triage" data-testid="triage-p1" data-signal-id={signalId}>
  <div class="triage-head">
    <span class="triage-title">Triage</span>
    <span class="triage-saved" data-testid="triage-saved">Enregistré : {savedText}</span>
  </div>
  <p class="triage-hint">Proposition P1 — Segmenté + motif contextuel : un seul choix à la fois.</p>
  <div class="seg" role="radiogroup" aria-label="Catégorie de triage">
    {#each ["pertinent", "a_surveiller", "non_pertinent"] as c (c)}
      <button
        type="button"
        role="radio"
        aria-checked={draft === c}
        class="seg-btn"
        class:active={draft === c}
        on:click={() => choose(c as Choice)}>{NAMES[c as Choice]}</button
      >
    {/each}
  </div>
  {#if draft !== "non_trie"}
    <label class="triage-field">
      <span>Motif — {NAMES[draft]} ({draft === "non_pertinent" ? "requis" : "facultatif"})</span>
      <select bind:value={code}>
        <option value="">{draft === "non_pertinent" ? "Choisir un code…" : "Sans code"}</option>
        {#each codes as r (r.code)}<option value={r.code}>{r.code}{r.label && r.label !== r.code ? ` — ${r.label}` : ""}</option>{/each}
      </select>
    </label>
  {/if}
  {#if plan}<p class="triage-plan">{plan}</p>{/if}
  <div class="triage-actions">
    <button type="button" class="triage-primary" disabled={!canSave} on:click={save}>Enregistrer</button>
    <button type="button" class="triage-link" disabled={saved.choice === "non_trie"} on:click={clear}>Retirer la classification</button>
  </div>
</div>

<style>
  .triage { margin-top: 0.5rem; padding: 0.5rem; border: 1px solid var(--st-semantic-border, #334155); border-radius: 0.375rem; display: flex; flex-direction: column; gap: 0.35rem; font-size: 0.8rem; }
  .triage-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; }
  .triage-title { font-weight: 600; }
  .triage-saved { color: var(--st-semantic-text-muted, #94a3b8); }
  .triage-hint { margin: 0; font-size: 0.7rem; color: var(--st-semantic-text-muted, #94a3b8); }
  .triage-plan { margin: 0; font-size: 0.72rem; }
  .triage-field { display: flex; flex-direction: column; gap: 0.2rem; }
  .triage-field select { padding: 0.25rem; }
  .triage-actions { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
  .triage-primary { padding: 0.3rem 0.7rem; border-radius: 0.25rem; border: 1px solid transparent; background: var(--st-semantic-accent, #2563eb); color: #fff; cursor: pointer; align-self: flex-start; }
  .triage-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .triage-link { background: none; border: 0; color: inherit; text-decoration: underline; cursor: pointer; padding: 0; }
  .triage-link:disabled { opacity: 0.5; cursor: not-allowed; }
  button:focus-visible, select:focus-visible { outline: 2px solid var(--st-semantic-focus, #60a5fa); outline-offset: 1px; }
  .seg { display: flex; flex-wrap: wrap; gap: 0; }
  .seg-btn { flex: 1 1 0; padding: 0.3rem 0.4rem; border: 1px solid var(--st-semantic-border, #334155); background: transparent; color: inherit; cursor: pointer; }
  .seg-btn.active { background: var(--st-semantic-accent, #2563eb); color: #fff; }
</style>
