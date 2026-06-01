<script lang="ts">
  import { onMount, tick } from "svelte";
  import { SendHorizontal, Sparkles } from "@lucide/svelte";
  import { Alert, Button, Select } from "@sentropic/design-system-svelte";
  import StreamMessage from "@sentropic/chat-ui/components/StreamMessage.svelte";
  import {
    fetchProviders,
    getStreamHub,
    startMessage,
    type ChatProvider,
    type ChatTurn,
  } from "$lib/chat/chat-client";

  type Turn =
    | { kind: "user"; content: string }
    | {
        kind: "assistant";
        streamId: string;
        status: string;
        finalContent: string | null;
      };

  let providers: ChatProvider[] = [];
  let providersLoaded = false;
  let providersError = "";
  // Selection combinee "providerId::modelId" (design sentropic, groupe par
  // fournisseur). Defaut neutre : 1er fournisseur (ordre alphabetique) + son
  // modele par defaut.
  let selectedModelKey = "";
  $: selectedProviderId = selectedModelKey.split("::")[0] ?? "";
  $: selectedModel = selectedModelKey.split("::")[1] ?? "";
  let draft = "";
  let sending = false;
  let turns: Turn[] = [];
  let scrollEl: HTMLDivElement | null = null;

  const streamClient = getStreamHub();

  // Resolver consumed by `StreamMessage` (mirror of sentropic's signature:
  // `(key, { values })`). Tool keys surface the backlog tool activity in
  // French ("Outil ajouter_demande ...").
  const labels = (
    key: string,
    options?: { values?: Record<string, unknown> },
  ): string => {
    const name = String(options?.values?.name ?? "");
    const dictionary: Record<string, string> = {
      "stream.inProgress": "Reponse en cours",
      "stream.done": "Termine",
      "stream.error": "Erreur",
      "stream.unknownError": "Erreur inconnue",
      "stream.response": "Reponse",
      "stream.status": "Statut",
      "stream.preparing": "Preparation",
      "stream.tool": `Outil ${name}`,
      "stream.toolArgs": `Arguments de ${name}`,
      "stream.toolArgsFallback": "Arguments de l'outil",
      "stream.toolCalls": "Appels d'outils",
    };
    return dictionary[key] ?? key;
  };

  $: configured = providersLoaded && providers.length > 0;

  const loadProviders = async (): Promise<void> => {
    try {
      const payload = await fetchProviders();
      providers = payload.providers;
      if (providers.length > 0 && !selectedModelKey) {
        // First configured provider alphabetically (server already sorts)
        // + its default model.
        const first = providers[0];
        selectedModelKey = `${first.id}::${first.defaultModel}`;
      }
      providersError = "";
    } catch (error) {
      providersError =
        error instanceof Error ? error.message : "Chargement impossible";
    } finally {
      providersLoaded = true;
    }
  };

  const scrollToBottom = async (): Promise<void> => {
    await tick();
    if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
  };

  const buildHistory = (): ChatTurn[] => {
    const history: ChatTurn[] = [];
    for (const turn of turns) {
      if (turn.kind === "user") {
        history.push({ role: "user", content: turn.content });
      } else if (turn.finalContent) {
        history.push({ role: "assistant", content: turn.finalContent });
      }
    }
    return history;
  };

  const send = async (): Promise<void> => {
    const content = draft.trim();
    if (!content || sending || !selectedProviderId) return;
    sending = true;
    draft = "";

    const history = buildHistory();
    turns = [...turns, { kind: "user", content }];
    await scrollToBottom();

    try {
      const messages: ChatTurn[] = [
        ...history,
        { role: "user", content },
      ];
      const started = await startMessage({
        providerId: selectedProviderId,
        model: selectedModel || undefined,
        messages,
      });
      turns = [
        ...turns,
        {
          kind: "assistant",
          streamId: started.streamId,
          status: "in_progress",
          finalContent: null,
        },
      ];
      await scrollToBottom();
    } catch (error) {
      turns = [
        ...turns,
        {
          kind: "assistant",
          streamId: `local-error-${Date.now()}`,
          status: "failed",
          finalContent:
            error instanceof Error ? error.message : "Erreur d'envoi",
        },
      ];
      sending = false;
      await scrollToBottom();
    }
  };

  const handleTerminal = (): void => {
    sending = false;
  };

  const handleStreamEvent = (): void => {
    void scrollToBottom();
  };

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  onMount(() => {
    void loadProviders();
  });
</script>

<section class="flex h-full min-h-0 flex-col bg-white">
  <header class="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
    <div class="min-w-0">
      <p class="truncate text-sm font-semibold text-slate-950">
        Assistant radar
      </p>
      <p class="truncate text-xs text-slate-500">
        Questionner les signaux et piloter le backlog
      </p>
    </div>
    {#if configured}
      <div class="w-52 shrink-0">
        <Select id="chat-model" label="Modele" bind:value={selectedModelKey}>
          {#each providers as provider}
            <optgroup label={provider.label}>
              {#each provider.models as model}
                <option value={`${provider.id}::${model.modelId}`}>
                  {model.label}
                </option>
              {/each}
            </optgroup>
          {/each}
        </Select>
      </div>
    {/if}
  </header>

  <div bind:this={scrollEl} class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
    {#if !providersLoaded}
      <p class="text-xs text-slate-500">Chargement des fournisseurs...</p>
    {:else if !configured}
      <Alert tone="warning" title="Aucun fournisseur LLM configure">
        Le chat est branche mais aucune cle d'API n'est definie. Renseignez au
        moins une variable d'environnement parmi <code>ANTHROPIC_API_KEY</code>,
        <code>OPENAI_API_KEY</code>, <code>GEMINI_API_KEY</code> (ou
        <code>GOOGLE_API_KEY</code>), <code>MISTRAL_API_KEY</code>,
        <code>COHERE_API_KEY</code> pour activer un fournisseur.
        {#if providersError}
          <span class="mt-2 block text-xs">Detail : {providersError}</span>
        {/if}
      </Alert>
    {:else if turns.length === 0}
      <div class="flex h-full items-center justify-center">
        <p class="max-w-xs text-center text-sm text-slate-500">
          Posez une question sur les signaux, les contraintes reglementaires ou
          une fiche d'opportunite. Vous pouvez aussi demander d'ajouter une
          demande au backlog (ex. « Ajoute une demande : carte interactive »).
        </p>
      </div>
    {:else}
      <div class="space-y-5">
        {#each turns as turn (turn.kind === "user" ? `u-${turn.content}-${turns.indexOf(turn)}` : turn.streamId)}
          {#if turn.kind === "user"}
            <div class="flex flex-col items-end">
              <div class="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-blue-700 px-3 py-2 text-sm text-white">
                {turn.content}
              </div>
            </div>
          {:else}
            <div class="flex items-start gap-2">
              <div
                class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-slate-600"
                aria-hidden="true"
              >
                <Sparkles class="h-3.5 w-3.5" />
              </div>
              <div class="min-w-0 max-w-[88%]">
                <p class="mb-1 text-[11px] text-slate-500">Assistant radar</p>
                <div class="rounded-2xl rounded-bl-sm border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900">
                  <StreamMessage
                    {streamClient}
                    {labels}
                    streamId={turn.streamId}
                    status={turn.status}
                    variant="chat"
                    subscriptionMode="live"
                    finalContent={turn.finalContent}
                    onTerminal={handleTerminal}
                    onStreamEvent={handleStreamEvent}
                  />
                </div>
              </div>
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  </div>

  <footer class="border-t border-slate-200 p-3">
    <div class="flex items-end gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <textarea
        class="max-h-32 min-h-[2.25rem] w-full flex-1 resize-none border-0 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400 disabled:opacity-60"
        rows="1"
        placeholder={configured
          ? "Questionner ce signal"
          : "Configurez un fournisseur pour discuter"}
        bind:value={draft}
        disabled={!configured || sending}
        on:keydown={handleKeyDown}
      ></textarea>
      <Button
        variant="primary"
        size="sm"
        disabled={!configured || sending || !draft.trim()}
        onclick={send}
      >
        <SendHorizontal class="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  </footer>
</section>
