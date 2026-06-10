<script lang="ts">
  import { onMount, tick } from "svelte";
  import { SendHorizontal, Sparkles, RotateCcw } from "@lucide/svelte";
  import { Alert, Button } from "@sentropic/design-system-svelte";
  import StreamMessage from "@sentropic/chat-ui/components/StreamMessage.svelte";
  import ModelSelector from "@sentropic/chat-ui/components/ModelSelector.svelte";
  import MessageActions from "@sentropic/chat-ui/components/MessageActions.svelte";
  import ContextChips from "@sentropic/chat-ui/components/ContextChips.svelte";
  import {
    computeModelSelectorWidthCh,
    groupModelsByProvider,
    parseModelSelectionKey,
    type ModelCatalogGroup,
    type ModelCatalogModel,
    type ModelProviderId,
  } from "@sentropic/chat-ui/utils/model-selection";
  import {
    fetchProviders,
    getStreamHub,
    startMessage,
    toModelCatalog,
    type ChatProvider,
    type ChatTurn,
  } from "$lib/chat/chat-client";
  import { radarChatContextProvider } from "$lib/chat/chat-context";

  type Turn =
    | { kind: "user"; content: string }
    | {
        kind: "assistant";
        streamId: string;
        status: string;
        finalContent: string | null;
        /** Vrai si restaure depuis localStorage (stream termine, rendu statique). */
        restored?: boolean;
        /** Pour un envoi echoue : contenu utilisateur a renvoyer via Reessayer. */
        retryContent?: string;
      };

  /** Cle de persistance locale de la conversation (survie au rechargement). */
  const STORAGE_KEY = "radar-chat-turns";
  const MAX_PERSISTED = 50;

  /** Suggestions de questions radar affichees dans l'etat vide du chat. */
  const RADAR_SUGGESTIONS: readonly string[] = [
    "Top opportunités ?",
    "Quelles villes ont un changement de zonage ?",
    "Détail Saint-Constant ?",
    "Détail Valleyfield ?",
  ];

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
  let textareaEl: HTMLTextAreaElement | null = null;
  /** Bulles assistant (par streamId) pour copier / capturer le texte final. */
  let bubbleEls: Record<string, HTMLElement> = {};
  /** streamId dont la copie vient de reussir (feedback transitoire). */
  let copiedStreamId = "";

  const streamClient = getStreamHub();

  // ── Catalogue ModelSelector (mapping ChatProvider[] -> formes chat-ui) ──────
  $: catalog = toModelCatalog(providers);
  $: modelGroups = groupModelsByProvider(
    catalog.providers,
    catalog.models,
  ) as ModelCatalogGroup[];
  $: catalogModels = catalog.models as ModelCatalogModel[];
  $: selectorWidthCh = computeModelSelectorWidthCh(
    modelGroups,
    catalogModels,
    (selectedProviderId || "openai") as ModelProviderId,
    selectedModel,
  );

  /** Action : enregistre le noeud de la bulle assistant pour copie/capture. */
  const registerBubble = (node: HTMLElement, streamId: string) => {
    bubbleEls[streamId] = node;
    return {
      destroy() {
        delete bubbleEls[streamId];
      },
    };
  };

  // Resolver consumed by `StreamMessage` (mirror of sentropic's signature:
  // `(key, { values })`). Tool keys surface the backlog tool activity in
  // French ("Outil ajouter_demande ..."). Also feeds `ModelSelector`,
  // `MessageActions` and `ContextChips` user-visible strings.
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
      "chat.model.selector.label": "Modele",
      "common.copy": "Copier",
      "common.retry": "Regenerer",
      "chat.message.edit": "Modifier",
      "chat.context.chips.label": "Contexte de la conversation",
      "chat.context.chip.signal": "Signal",
      "chat.context.chip.opportunite": "Opportunite",
      "chat.context.chip.remove": "Retirer du contexte",
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

  /** ModelSelector onChange : recompose la cle "providerId::modelId". */
  const handleModelChange = (payload: {
    providerId: ModelProviderId;
    modelId: string;
  }): void => {
    selectedModelKey = `${payload.providerId}::${payload.modelId}`;
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
      } else if (turn.status !== "failed" && turn.finalContent) {
        // Inclut la reponse de l'assistant dans l'historique (le modele voit
        // ses propres tours). Les envois echoues sont exclus.
        history.push({ role: "assistant", content: turn.finalContent });
      }
    }
    return history;
  };

  /** Persiste la conversation (tours user + reponses terminees) en local. */
  const persistTurns = (): void => {
    if (typeof localStorage === "undefined") return;
    const keep = turns
      .filter(
        (t) =>
          t.kind === "user" ||
          (t.status !== "failed" && typeof t.finalContent === "string"),
      )
      .slice(-MAX_PERSISTED);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(keep));
    } catch {
      // quota / mode prive : on ignore silencieusement.
    }
  };

  /** Restaure la conversation depuis le stockage local (rendu statique). */
  const loadTurns = (): void => {
    if (typeof localStorage === "undefined") return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Turn[];
      if (!Array.isArray(parsed)) return;
      turns = parsed.map((t) =>
        t.kind === "assistant"
          ? { ...t, restored: true, status: "done", retryContent: undefined }
          : t,
      );
    } catch {
      // donnees corrompues : on repart vierge.
    }
  };

  const sendContent = async (content: string): Promise<void> => {
    if (!content || sending || !selectedProviderId) return;
    sending = true;

    const history = buildHistory();
    turns = [...turns, { kind: "user", content }];
    await scrollToBottom();

    try {
      const messages: ChatTurn[] = [...history, { role: "user", content }];
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
    } catch (error) {
      turns = [
        ...turns,
        {
          kind: "assistant",
          streamId: `local-error-${turns.length}`,
          status: "failed",
          finalContent:
            error instanceof Error ? error.message : "Erreur d'envoi",
          retryContent: content,
        },
      ];
      sending = false;
    }
    await scrollToBottom();
    persistTurns();
  };

  const send = async (): Promise<void> => {
    const content = draft.trim();
    if (!content) return;
    draft = "";
    await sendContent(content);
  };

  /** Re-soumet un envoi echoue : retire le tour echoue + son tour user. */
  const retry = async (turn: Extract<Turn, { kind: "assistant" }>): Promise<void> => {
    const idx = turns.indexOf(turn);
    if (idx < 1 || !turn.retryContent) return;
    turns = turns.slice(0, idx - 1);
    await sendContent(turn.retryContent);
  };

  /**
   * Regenere une reponse assistant terminee : retire le tour assistant + son
   * tour user, puis renvoie le meme prompt utilisateur.
   */
  const regenerate = async (
    turn: Extract<Turn, { kind: "assistant" }>,
  ): Promise<void> => {
    if (sending) return;
    const idx = turns.indexOf(turn);
    const previous = turns[idx - 1];
    if (idx < 1 || !previous || previous.kind !== "user") return;
    const prompt = previous.content;
    turns = turns.slice(0, idx - 1);
    await sendContent(prompt);
  };

  /** Edite un message utilisateur : repositionne le texte + tronque la suite. */
  const editMessage = async (turn: Extract<Turn, { kind: "user" }>): Promise<void> => {
    if (sending) return;
    const idx = turns.indexOf(turn);
    if (idx < 0) return;
    draft = turn.content;
    turns = turns.slice(0, idx);
    persistTurns();
    await tick();
    textareaEl?.focus();
  };

  /** Copie le texte d'un message utilisateur (capture clipboard). */
  const copyUser = async (content: string, key: string): Promise<void> => {
    if (!content.trim()) return;
    try {
      await navigator.clipboard.writeText(content.trim());
      copiedStreamId = key;
      setTimeout(() => {
        if (copiedStreamId === key) copiedStreamId = "";
      }, 1500);
    } catch {
      // clipboard indisponible : on ignore.
    }
  };

  const copyMessage = async (
    turn: Extract<Turn, { kind: "assistant" }>,
  ): Promise<void> => {
    const text =
      turn.finalContent ?? bubbleEls[turn.streamId]?.innerText ?? "";
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text.trim());
      copiedStreamId = turn.streamId;
      setTimeout(() => {
        if (copiedStreamId === turn.streamId) copiedStreamId = "";
      }, 1500);
    } catch {
      // clipboard indisponible : on ignore.
    }
  };

  /** Au terminal d'un stream : capture le texte rendu + persiste. */
  const handleTerminal = async (streamId: string): Promise<void> => {
    sending = false;
    await tick();
    const captured = bubbleEls[streamId]?.innerText?.trim();
    if (captured) {
      turns = turns.map((t) =>
        t.kind === "assistant" && t.streamId === streamId
          ? { ...t, finalContent: captured, status: "done" }
          : t,
      );
    }
    persistTurns();
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
    loadTurns();
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
      <div class="shrink-0">
        <ModelSelector
          bind:value={selectedModelKey}
          groups={modelGroups}
          models={catalogModels}
          widthCh={selectorWidthCh}
          {labels}
          onChange={handleModelChange}
        />
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
      <div class="flex h-full flex-col items-center justify-center gap-4 px-2">
        <p class="max-w-xs text-center text-sm text-slate-500">
          Posez une question sur les signaux, les opportunites ou les
          reglements. Exemples :
        </p>
        <div class="flex flex-wrap justify-center gap-2">
          {#each RADAR_SUGGESTIONS as suggestion (suggestion)}
            <button
              type="button"
              class="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-700 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-50"
              disabled={!configured || sending}
              on:click={() => sendContent(suggestion)}
            >
              {suggestion}
            </button>
          {/each}
        </div>
      </div>
    {:else}
      <div class="space-y-5">
        {#each turns as turn (turn.kind === "user" ? `u-${turn.content}-${turns.indexOf(turn)}` : turn.streamId)}
          {#if turn.kind === "user"}
            {@const userKey = `u-${turns.indexOf(turn)}`}
            <div class="group flex flex-col items-end">
              <div class="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-blue-700 px-3 py-2 text-sm text-white">
                {turn.content}
              </div>
              <MessageActions
                role="user"
                streamStatus="completed"
                isCopied={copiedStreamId === userKey}
                {labels}
                onCopy={() => copyUser(turn.content, userKey)}
                onEdit={() => editMessage(turn)}
              />
            </div>
          {:else}
            <div class="group flex items-start gap-2">
              <div
                class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-slate-600"
                aria-hidden="true"
              >
                <Sparkles class="h-3.5 w-3.5" />
              </div>
              <div class="min-w-0 max-w-[88%]">
                <p class="mb-1 text-[11px] text-slate-500">Assistant radar</p>
                {#if turn.status === "failed"}
                  <div class="rounded-2xl rounded-bl-sm border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                    {turn.finalContent}
                    {#if turn.retryContent}
                      <button
                        class="mt-2 flex items-center gap-1 text-xs font-medium text-rose-700 hover:text-rose-900"
                        type="button"
                        disabled={sending}
                        on:click={() => retry(turn)}
                      >
                        <RotateCcw class="h-3.5 w-3.5" aria-hidden="true" />
                        Reessayer
                      </button>
                    {/if}
                  </div>
                {:else}
                  <div
                    class="rounded-2xl rounded-bl-sm border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                    use:registerBubble={turn.streamId}
                  >
                    {#if turn.restored}
                      <div class="whitespace-pre-wrap break-words">{turn.finalContent}</div>
                    {:else}
                      <StreamMessage
                        {streamClient}
                        {labels}
                        streamId={turn.streamId}
                        status={turn.status}
                        variant="chat"
                        subscriptionMode="live"
                        smoothContentStreaming={true}
                        finalContent={turn.finalContent}
                        onTerminal={() => handleTerminal(turn.streamId)}
                        onStreamEvent={handleStreamEvent}
                      />
                    {/if}
                  </div>
                  <MessageActions
                    role="assistant"
                    streamStatus={turn.status === "in_progress"
                      ? "processing"
                      : "completed"}
                    isLastAssistantSegment={true}
                    isCopied={copiedStreamId === turn.streamId}
                    {labels}
                    onCopy={() => copyMessage(turn)}
                    onRegenerate={() => regenerate(turn)}
                  />
                {/if}
              </div>
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  </div>

  <footer class="border-t border-slate-200 p-3">
    {#if configured}
      <div class="mb-2">
        <ContextChips provider={radarChatContextProvider} {labels} />
      </div>
    {/if}
    <div class="flex items-end gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <textarea
        bind:this={textareaEl}
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
