<script lang="ts">
  /**
   * EntityAnnotations — surface PRÉSENTIELLE des notes d'une entité (signal/lot).
   * CONTRACT-AGNOSTIC : reçoit `notes[]` + callbacks add/edit/delete ; le parent
   * (SignauxSelPanel pour un signal, LotFichePanel pour un lot) fournit les
   * données et lie le client API (extraction/i-arch) une fois le contrat figé.
   *
   * Décisions owner reflétées : D2 = édition + suppression (proposées seulement
   * sur SES propres notes → marche pour les modèles personnel ET team-partagé) ;
   * D3 = ouvert à tout user approuvé (`canAnnotate`). Vocabulaire unifié « note »
   * (pas de jargon prospect « équipe / mode réel / simulation »).
   */
  import type { EntityAnnotation } from "$lib/collab/annotation.js";

  export let notes: EntityAnnotation[] = [];
  /** Id de l'utilisateur courant (`$authStore.user.sub`) — pour ne proposer
   *  édition/suppression que sur ses propres notes. */
  export let currentUserId: string | null = null;
  /** owner-D3 : ouvert à tout user approuvé. Le parent passe `false` pour un
   *  compte pending/rejected → surface en lecture seule. */
  export let canAnnotate = true;
  /** Une mutation est en vol (désactive les contrôles). */
  export let busy = false;
  export let error: string | null = null;

  export let onAdd: (body: string) => void = () => {};
  export let onEdit: (id: string, body: string) => void = () => {};
  export let onDelete: (id: string) => void = () => {};

  let draft = "";
  let editingId: string | null = null;
  let editDraft = "";

  function ownNote(note: EntityAnnotation): boolean {
    return currentUserId !== null && note.authorId === currentUserId;
  }

  function submitAdd(): void {
    const body = draft.trim();
    if (!body || busy) return;
    onAdd(body);
    draft = "";
  }
  function startEdit(note: EntityAnnotation): void {
    editingId = note.id;
    editDraft = note.body;
  }
  function submitEdit(): void {
    const body = editDraft.trim();
    if (editingId === null || !body || busy) return;
    onEdit(editingId, body);
    editingId = null;
    editDraft = "";
  }
  function cancelEdit(): void {
    editingId = null;
    editDraft = "";
  }
  function fmtDate(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("fr-CA");
  }
</script>

<section class="space-y-2" data-testid="entity-annotations" aria-label="Notes">
  <div class="flex items-center gap-2">
    <span class="text-xs font-semibold uppercase tracking-wide text-slate-500">Notes</span>
    <span
      class="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600"
      data-testid="annotations-count">{notes.length}</span>
  </div>

  {#if error}
    <p class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">{error}</p>
  {/if}

  {#if notes.length > 0}
    <ul class="space-y-1.5" aria-label="Liste des notes">
      {#each notes as note (note.id)}
        <li
          class="rounded-lg border border-slate-100 bg-white px-3 py-2 text-xs text-slate-600"
          data-testid="annotation-item">
          {#if editingId === note.id}
            <textarea
              class="w-full resize-none rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 focus:border-teal-400 focus:outline-none"
              rows="2"
              bind:value={editDraft}
              disabled={busy}
              aria-label="Modifier la note"
            ></textarea>
            <div class="mt-1 flex justify-end gap-1.5">
              <button
                type="button"
                class="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
                onclick={cancelEdit}
                disabled={busy}>Annuler</button>
              <button
                type="button"
                class="rounded-md bg-teal-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-40"
                onclick={submitEdit}
                disabled={!editDraft.trim() || busy}
                data-testid="annotation-save-edit">Enregistrer</button>
            </div>
          {:else}
            <p class="whitespace-pre-wrap leading-snug">{note.body}</p>
            <div class="mt-1 flex items-center justify-between gap-2">
              <p class="text-[11px] text-slate-400">
                {fmtDate(note.createdAt)}{#if note.authorName} · {note.authorName}{/if}{#if note.updatedAt} · modifiée{/if}
              </p>
              {#if ownNote(note)}
                <div class="flex shrink-0 gap-2">
                  <button
                    type="button"
                    class="text-[11px] text-slate-500 transition hover:text-slate-800 disabled:opacity-40"
                    onclick={() => startEdit(note)}
                    disabled={busy}
                    data-testid="annotation-edit">Modifier</button>
                  <button
                    type="button"
                    class="text-[11px] text-red-500 transition hover:text-red-700 disabled:opacity-40"
                    onclick={() => onDelete(note.id)}
                    disabled={busy}
                    data-testid="annotation-delete">Supprimer</button>
                </div>
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {:else}
    <p
      class="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-400 italic"
      data-testid="annotations-empty">Aucune note.</p>
  {/if}

  {#if canAnnotate}
    <div class="space-y-1">
      <textarea
        class="w-full resize-none rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 focus:border-teal-400 focus:outline-none"
        rows="2"
        placeholder="Ajouter une note…"
        bind:value={draft}
        disabled={busy}
        aria-label="Nouvelle note"
        data-testid="annotation-new"
      ></textarea>
      <div class="flex justify-end">
        <button
          type="button"
          class="rounded-md bg-teal-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-40"
          onclick={submitAdd}
          disabled={!draft.trim() || busy}
          data-testid="annotation-add">{busy ? "Enregistrement…" : "Ajouter"}</button>
      </div>
    </div>
  {:else}
    <p class="text-xs text-slate-400" data-testid="annotations-readonly">
      Connexion requise pour annoter.
    </p>
  {/if}
</section>
