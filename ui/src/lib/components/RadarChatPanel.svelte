<script lang="ts">
  import { Bot, SendHorizontal, Sparkles } from "@lucide/svelte";
  import PackageChatPanel from "@sentropic/chat-ui/components/ChatPanel.svelte";

  const labels: Record<string, string> = {
    "chat.tabs.chat": "Assistant radar",
    "chat.sessions.none": "Aucune session active",
    "chat.composer.placeholder.chat": "Questionner les signaux municipaux",
  };

  const resolveLabel = (key: string): string => labels[key] ?? key;
</script>

{#snippet renderHeader()}
  <header class="border-b border-slate-200 px-4 py-3">
    <div class="flex items-center gap-2">
      <div class="flex h-8 w-8 items-center justify-center rounded-md bg-blue-700 text-white">
        <Bot class="h-4 w-4" aria-hidden="true" />
      </div>
      <div>
        <h2 class="text-sm font-semibold text-slate-950">Assistant radar</h2>
        <p class="text-xs text-slate-500">Shell chat Sentropic, outils radar a venir</p>
      </div>
    </div>
  </header>
{/snippet}

{#snippet renderTimeline()}
  <div class="flex h-full flex-col justify-between gap-4 p-4">
    <div class="rounded-md border border-blue-100 bg-blue-50 p-3">
      <div class="flex items-center gap-2 text-sm font-semibold text-blue-900">
        <Sparkles class="h-4 w-4" aria-hidden="true" />
        Analyse disponible
      </div>
      <p class="mt-2 text-sm leading-6 text-blue-950">
        Je peux expliquer les signaux, comparer les contraintes et preparer une
        fiche d'opportunite lorsque le backend chat sera branche.
      </p>
    </div>

    <div class="space-y-2 text-xs text-slate-500">
      <p class="font-semibold text-slate-700">Outils prevus</p>
      <div class="flex flex-wrap gap-2">
        <span class="rounded-md bg-slate-100 px-2 py-1">resumer_document</span>
        <span class="rounded-md bg-slate-100 px-2 py-1">expliquer_score</span>
        <span class="rounded-md bg-slate-100 px-2 py-1">trouver_lots</span>
      </div>
    </div>
  </div>
{/snippet}

{#snippet renderComposer()}
  <footer class="border-t border-slate-200 p-3">
    <div class="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <span class="min-w-0 flex-1 truncate text-sm text-slate-500">
        Questionner ce signal
      </span>
      <button
        class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-900 text-white opacity-60"
        type="button"
        aria-label="Envoyer"
        title="Envoyer"
        disabled
      >
        <SendHorizontal class="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  </footer>
{/snippet}

<section class="min-h-[320px] overflow-hidden rounded-md border border-slate-200 bg-white">
  <PackageChatPanel
    labels={resolveLabel}
    featureFlags={{ radarTools: true }}
    renderHeader={renderHeader}
    renderTimeline={renderTimeline}
    renderComposer={renderComposer}
  />
</section>
