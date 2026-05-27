<script lang="ts">
  import { Shield, CheckCircle2, BookOpen, User, Bot, Music2, MessageSquare, Info, AlertCircle } from "@lucide/svelte";
  import { radarPolicy, createJournal, summarizePolicy, submitInstruction, ROLE_LABELS_FR } from "$lib/coordination/coordination.js";
  import type { CoordinationJournalEntry } from "$lib/coordination/coordination.js";

  // ── Journal local state ─────────────────────────────────────────────────────
  const now = new Date().toISOString();
  const journal = createJournal([
    { id: "j-seed-1", who: "Vous", role: "principal", action: "qualifier H-609-4 avec expert", at: now },
    { id: "j-seed-2", who: "Vous", role: "principal", action: "surveiller U-521 (attente rôle)", at: now },
  ]);

  let entries: readonly CoordinationJournalEntry[] = journal.entries;

  // ── Stub chat composer ──────────────────────────────────────────────────────
  let inputText = "";

  function handleSubmit() {
    const text = inputText.trim();
    if (!text) return;
    submitInstruction(journal, text);
    entries = journal.entries; // trigger Svelte reactivity
    inputText = "";
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSubmit();
    }
  }

  // ── Role display helpers ────────────────────────────────────────────────────
  function roleBadgeClass(role: string): string {
    if (role === "principal") return "bg-teal-100 text-teal-700";
    if (role === "conductor") return "bg-violet-100 text-violet-700";
    return "bg-slate-100 text-slate-500";
  }

  function formatDate(iso: string): string {
    try {
      return new Date(iso).toLocaleString("fr-CA", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return iso;
    }
  }
</script>

<section class="min-h-full bg-slate-50 p-6 space-y-6">

  <!-- ── 1. Header ──────────────────────────────────────────────────────────-->
  <header class="mb-2">
    <p class="text-xs font-medium uppercase tracking-normal text-teal-700">
      Socle ÉV5 — coordination
    </p>
    <div class="mt-1 flex flex-wrap items-center gap-3">
      <h1 class="text-2xl font-semibold tracking-normal text-slate-950">
        Coordination humain ↔ agents
      </h1>
      <span class="rounded-full bg-teal-100 px-3 py-0.5 text-sm font-semibold text-teal-700">
        <User class="inline h-3.5 w-3.5 mr-1 -mt-0.5" aria-hidden="true" />
        {ROLE_LABELS_FR["principal"]}
      </span>
    </div>
    <p class="mt-2 text-sm text-slate-500 leading-6">
      L'IA n'est jamais <span class="font-semibold text-slate-700">PRINCIPAL</span> — elle orchestre
      (<span class="font-medium">chef d'orchestre / agents</span>) sous une
      <span class="font-medium text-violet-700">POLICY</span>. (socle §11)
    </p>
  </header>

  <!-- ── 2. POLICY panel ───────────────────────────────────────────────────-->
  <div class="rounded-lg border border-violet-200 bg-white shadow-sm">
    <div class="flex items-center gap-3 border-b border-violet-100 bg-violet-50 px-4 py-3">
      <Shield class="h-4 w-4 shrink-0 text-violet-600" aria-hidden="true" />
      <div class="flex-1 min-w-0">
        <p class="text-sm font-semibold text-slate-950">{radarPolicy.title}</p>
        <p class="text-xs text-slate-500">{summarizePolicy(radarPolicy)}</p>
      </div>
    </div>
    <ul class="divide-y divide-slate-100">
      {#each radarPolicy.rules as rule}
        <li class="flex items-start gap-3 px-4 py-2.5">
          <CheckCircle2 class="mt-0.5 h-4 w-4 shrink-0 text-violet-500" aria-hidden="true" />
          <span class="text-sm leading-6 text-slate-700">{rule}</span>
        </li>
      {/each}
    </ul>
  </div>

  <!-- ── 3. Journal panel ──────────────────────────────────────────────────-->
  <div class="rounded-lg border border-slate-200 bg-white shadow-sm">
    <div class="flex items-center gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3">
      <BookOpen class="h-4 w-4 shrink-0 text-teal-600" aria-hidden="true" />
      <div class="flex-1 min-w-0">
        <p class="text-sm font-semibold text-slate-950">Journal des décisions</p>
        <p class="text-xs text-slate-500">Append-only — {entries.length} entrée{entries.length !== 1 ? "s" : ""}</p>
      </div>
    </div>

    {#if entries.length === 0}
      <p class="px-4 py-4 text-sm text-slate-400 italic">Aucune entrée pour l'instant.</p>
    {:else}
      <ul class="divide-y divide-slate-100">
        {#each entries as entry (entry.id)}
          <li class="flex items-start gap-3 px-4 py-3">
            {#if entry.role === "principal"}
              <User class="mt-0.5 h-4 w-4 shrink-0 text-teal-500" aria-hidden="true" />
            {:else if entry.role === "conductor"}
              <Music2 class="mt-0.5 h-4 w-4 shrink-0 text-violet-500" aria-hidden="true" />
            {:else}
              <Bot class="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
            {/if}
            <div class="flex-1 min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <span class={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${roleBadgeClass(entry.role)}`}>
                  {ROLE_LABELS_FR[entry.role]}
                </span>
                <span class="text-xs font-medium text-slate-700">{entry.who}</span>
                <span class="text-[11px] text-slate-400">{formatDate(entry.at)}</span>
              </div>
              <p class="mt-0.5 text-sm leading-5 text-slate-700">{entry.action}</p>
              {#if entry.note}
                <p class="mt-0.5 text-xs italic text-slate-400">{entry.note}</p>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}

    <div class="flex items-center gap-2 border-t border-slate-100 bg-slate-50 px-4 py-2">
      <Info class="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
      <p class="text-[11px] text-slate-400">Journal append-only — aucune suppression ni modification.</p>
    </div>
  </div>

  <!-- ── 4. Stub chat composer ─────────────────────────────────────────────-->
  <div class="rounded-lg border border-slate-200 bg-white shadow-sm">
    <div class="flex items-center gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3">
      <MessageSquare class="h-4 w-4 shrink-0 text-teal-600" aria-hidden="true" />
      <p class="text-sm font-semibold text-slate-950">Composer une instruction</p>
    </div>

    <div class="px-4 py-4 space-y-3">
      <div class="flex gap-2">
        <input
          type="text"
          bind:value={inputText}
          on:keydown={handleKeydown}
          placeholder="Tapez une instruction pour le chef d'orchestre…"
          class="flex-1 rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 placeholder-slate-400 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-300"
        />
        <button
          type="button"
          on:click={handleSubmit}
          disabled={!inputText.trim()}
          class="rounded bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Envoyer
        </button>
      </div>
    </div>

    <div class="flex items-start gap-2 border-t border-amber-100 bg-amber-50 px-4 py-2.5">
      <AlertCircle class="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden="true" />
      <p class="text-[11px] text-amber-700">
        Chat de démonstration — aucun appel LLM réel. Les réponses sont simulées localement.
      </p>
    </div>
  </div>

</section>
