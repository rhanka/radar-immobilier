<script lang="ts">
  /**
   * SignalFacetControls — basket/archive controls inside an unfolded signal
   * card (never the card head button).
   *
   * - Pertinent / À surveiller: two independent toggles with an optional
   *   reason code each; an active basket offers removal or a code change.
   * - Écarter: mandatory code (submit disabled without one), never sends a
   *   deselection; an archived signal offers Restaurer instead.
   * - Code lists are filtered on the EXACT verdict, never on the code prefix;
   *   codes render verbatim. Unreadable codes inactivate every control.
   * - No optimistic display: the parent owns heads and reloads them after
   *   onSaved; a failure keeps the previous state visible plus a per-status
   *   message, with a same-key retry.
   */
  import { tick } from "svelte";
  import { Alert, Button, Select } from "@sentropic/design-system-svelte";
  import {
    codesForVerdict,
    createCommandKey,
    facetErrorMessage,
    isFacetWriteUnconfirmed,
    postFacetCommand,
    SignalFacetError,
    type FacetAction,
    type FacetBasket,
    type FacetCommandBody,
    type FacetTarget,
    type ReasonCode,
    type TargetFacetState,
  } from "$lib/signals/signal-facets-client.js";

  export let target: FacetTarget;
  export let state: TargetFacetState;
  /** Null when the codebook is unreadable: every control stays inactive. */
  export let codes: ReasonCode[] | null = null;
  export let codesError: string | null = null;
  export let codesLoading = false;
  /** Parent-level inactivation (not allowed, reload in flight). */
  export let disabled = false;
  /** Injectable for tests; defaults to the real facet client. */
  export let postCommand: typeof postFacetCommand = postFacetCommand;
  /** The parent purges its caches and re-reads detail, heads and by-city. */
  export let onSaved: (action: FacetAction) => void | Promise<void> = () => {};
  /** Reload the reason codebook (parent-owned read). */
  export let onRetryCodes: () => void = () => {};

  let rootEl: HTMLDivElement | null = null;

  let busy = false;
  let error: string | null = null;
  let unconfirmed = false;
  let commandKey: string | null = null;
  let lastIntent: string | null = null;
  let pertinentCode = "";
  let watchingCode = "";
  let discardCode = "";

  $: pertinentCode = state.pertinentCode ?? "";
  $: watchingCode = state.watchingCode ?? "";

  $: pertinentCodes = codes ? codesForVerdict(codes, "pertinent") : [];
  $: watchingCodes = codes ? codesForVerdict(codes, "a_surveiller") : [];
  $: discardCodes = codes ? codesForVerdict(codes, "non_pertinent") : [];
  $: codesReady = codes !== null && !codesLoading;
  $: inactive = disabled || busy || !codesReady;

  function describeTarget(): string {
    return `${target.type} ${target.id}`;
  }

  /**
   * Return focus to the control that started the write (disabling it moves
   * focus to the body), or to the first enabled control when the write
   * replaced it. Only repairs a lost focus — never steals a moved one.
   */
  function isStillFocusable(element: HTMLElement | null): element is HTMLElement {
    if (!element || !rootEl?.contains(element)) return false;
    if (!element.isConnected) return false;
    if ((element as HTMLButtonElement).disabled) return false;
    if (element.getAttribute("aria-disabled") === "true") return false;
    return true;
  }

  function focusFallback(): void {
    const fallback = rootEl?.querySelector<HTMLElement>(
      "button:not([disabled]), select:not([disabled])",
    );
    if (fallback) {
      fallback.focus({ preventScroll: true });
      return;
    }
    rootEl
      ?.closest("[data-signal-node]")
      ?.querySelector<HTMLElement>(".sel-entity-head")
      ?.focus({ preventScroll: true });
  }

  function restoreFocus(trigger: HTMLElement | null): void {
    if (typeof document === "undefined") return;
    const active = document.activeElement;
    if (active === document.body || active === trigger) {
      if (isStillFocusable(trigger)) {
        trigger.focus({ preventScroll: true });
        return;
      }
      focusFallback();
    }
  }

  async function run(action: FacetAction, body: FacetCommandBody): Promise<void> {
    const intent = JSON.stringify([action, body]);
    // One key per intention, reused when retrying the same intention.
    if (lastIntent !== intent) {
      commandKey = createCommandKey();
      lastIntent = intent;
    }
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    busy = true;
    error = null;
    try {
      await postCommand("", action, body, commandKey!);
      commandKey = null;
      lastIntent = null;
      discardCode = "";
      await onSaved(action);
    } catch (err) {
      unconfirmed = isFacetWriteUnconfirmed(err);
      if (!unconfirmed) {
        lastIntent = null;
        commandKey = null;
      }
      error =
        err instanceof SignalFacetError
          ? facetErrorMessage(err)
          : "Écriture non confirmée — Réessayer.";
    } finally {
      busy = false;
      await tick();
      restoreFocus(trigger);
    }
  }

  function retry(): void {
    if (!lastIntent) return;
    const [action, body] = JSON.parse(lastIntent) as [FacetAction, FacetCommandBody];
    void run(action, body);
  }

  function selectBasket(basket: FacetBasket, code: string): void {
    void run("select", {
      target,
      basket,
      ...(code ? { reasonCode: code } : {}),
    });
  }

  function deselectBasket(basket: FacetBasket): void {
    void run("deselect", { target, basket });
  }
</script>

<div class="facet-controls" bind:this={rootEl} data-testid="signal-facet-controls" data-target={describeTarget()}>
  {#if !codesReady}
    {#if codesLoading}
      <Alert
        tone="info"
        title="Chargement des codes…"
        message="Chargement des codes de motif — les contrôles sont inactifs en attendant."
      />
    {:else}
      <Alert
        tone="info"
        title="Classement indisponible"
        message={codesError ?? "Codes de motif illisibles — rechargez la ville ou relisez les codes."}
      />
      <div class="facet-error-actions">
        <Button
          variant="secondary"
          size="sm"
          type="button"
          disabled={disabled || busy}
          onclick={onRetryCodes}
          data-testid="facet-retry-codes"
        >
          Relire les codes
        </Button>
      </div>
    {/if}
  {/if}

  {#if error}
    <Alert tone="error" title={unconfirmed ? "Écriture non confirmée" : "Écriture refusée"} message={error} />
    {#if unconfirmed}
    <div class="facet-error-actions">
      <Button
        variant="secondary"
        size="sm"
        type="button"
        disabled={inactive}
        onclick={retry}
        data-testid="facet-retry"
      >
        Réessayer
      </Button>
    </div>
    {/if}
  {/if}

  <div class="facet-baskets">
    <div class="facet-row" role="group" aria-label="Pertinent" data-testid="facet-row-pertinent">
      <span class="facet-name">Pertinent</span>
      {#if state.pertinent}
        <span class="facet-state" data-testid="facet-state-pertinent">Dans le panier{#if state.pertinentCode} · {state.pertinentCode}{/if}</span>
        <Select
          label="Code (facultatif) — Pertinent"
          size="sm"
          bind:value={pertinentCode}
          disabled={inactive}
          data-testid="facet-select-pertinent"
        >
          <option value="">Sans code</option>
          {#each pertinentCodes as row (row.code)}
            <option value={row.code}>{row.code}</option>
          {/each}
        </Select>
        <div class="facet-actions">
          <Button
            variant="secondary"
            size="sm"
            type="button"
            disabled={inactive || pertinentCode === (state.pertinentCode ?? "")}
            onclick={() => selectBasket("pertinent", pertinentCode)}
            aria-label="Changer le code du panier Pertinent"
            data-testid="facet-update-pertinent-code"
          >
            Changer le code
          </Button>
          <Button
            variant="secondary"
            size="sm"
            type="button"
            disabled={inactive}
            onclick={() => deselectBasket("pertinent")}
            aria-label="Retirer du panier Pertinent"
            data-testid="facet-toggle-pertinent"
          >
            Retirer
          </Button>
        </div>
      {:else}
        <Select
          label="Code (facultatif) — Pertinent"
          size="sm"
          bind:value={pertinentCode}
          disabled={inactive}
          data-testid="facet-select-pertinent"
        >
          <option value="">Sans code</option>
          {#each pertinentCodes as row (row.code)}
            <option value={row.code}>{row.code}</option>
          {/each}
        </Select>
        <div class="facet-actions">
          <Button
            variant="secondary"
            size="sm"
            type="button"
            disabled={inactive}
            onclick={() => selectBasket("pertinent", pertinentCode)}
            aria-label="Ajouter au panier Pertinent"
            data-testid="facet-toggle-pertinent"
          >
            Ajouter
          </Button>
        </div>
      {/if}
    </div>

    <div class="facet-row" role="group" aria-label="À surveiller" data-testid="facet-row-watching">
      <span class="facet-name">À surveiller</span>
      {#if state.watching}
        <span class="facet-state" data-testid="facet-state-watching">Dans le panier{#if state.watchingCode} · {state.watchingCode}{/if}</span>
        <Select
          label="Code (facultatif) — À surveiller"
          size="sm"
          bind:value={watchingCode}
          disabled={inactive}
          data-testid="facet-select-watching"
        >
          <option value="">Sans code</option>
          {#each watchingCodes as row (row.code)}
            <option value={row.code}>{row.code}</option>
          {/each}
        </Select>
        <div class="facet-actions">
          <Button
            variant="secondary"
            size="sm"
            type="button"
            disabled={inactive || watchingCode === (state.watchingCode ?? "")}
            onclick={() => selectBasket("a_surveiller", watchingCode)}
            aria-label="Changer le code du panier À surveiller"
            data-testid="facet-update-watching-code"
          >
            Changer le code
          </Button>
          <Button
            variant="secondary"
            size="sm"
            type="button"
            disabled={inactive}
            onclick={() => deselectBasket("a_surveiller")}
            aria-label="Retirer du panier À surveiller"
            data-testid="facet-toggle-watching"
          >
            Retirer
          </Button>
        </div>
      {:else}
        <Select
          label="Code (facultatif) — À surveiller"
          size="sm"
          bind:value={watchingCode}
          disabled={inactive}
          data-testid="facet-select-watching"
        >
          <option value="">Sans code</option>
          {#each watchingCodes as row (row.code)}
            <option value={row.code}>{row.code}</option>
          {/each}
        </Select>
        <div class="facet-actions">
          <Button
            variant="secondary"
            size="sm"
            type="button"
            disabled={inactive}
            onclick={() => selectBasket("a_surveiller", watchingCode)}
            aria-label="Ajouter au panier À surveiller"
            data-testid="facet-toggle-watching"
          >
            Ajouter
          </Button>
        </div>
      {/if}
    </div>
  </div>

  <div class="facet-archive" role="group" aria-label={state.archived ? "Écarté" : "Écarter"} data-testid="facet-row-archive">
    {#if state.archived}
      <span class="facet-name">Écarté{#if state.archiveCode} · {state.archiveCode}{/if}</span>
      <div class="facet-actions">
        <Button
          variant="secondary"
          size="sm"
          type="button"
          disabled={inactive}
          onclick={() => run("restore", { target })}
          aria-label="Restaurer le signal écarté"
          data-testid="facet-restore"
        >
          Restaurer
        </Button>
      </div>
    {:else}
      <span class="facet-name">Écarter</span>
      <p class="facet-hint">Archive le signal avec un code obligatoire. Les paniers sont conservés.</p>
      <Select
        label="Code de motif (requis) — Écarter"
        size="sm"
        bind:value={discardCode}
        disabled={inactive}
        data-testid="facet-select-discard"
      >
        <option value="">Choisir un code…</option>
        {#each discardCodes as row (row.code)}
          <option value={row.code}>{row.code}</option>
        {/each}
      </Select>
      <div class="facet-actions">
        <Button
          variant="primary"
          size="sm"
          type="button"
          disabled={inactive || !discardCode}
          onclick={() => run("discard", { target, reasonCode: discardCode })}
          aria-label="Valider l'écart du signal"
          data-testid="facet-discard-submit"
        >
          Valider
        </Button>
      </div>
    {/if}
  </div>
</div>

<style>
  .facet-controls {
    display: grid;
    gap: 0.625rem;
    margin-top: 0.625rem;
    padding-top: 0.625rem;
    border-top: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
  }
  .facet-baskets {
    display: grid;
    gap: 0.5rem;
  }
  .facet-row,
  .facet-archive {
    display: grid;
    gap: 0.375rem;
  }
  .facet-name {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--st-semantic-text-secondary, #334155);
  }
  .facet-state {
    font-size: 0.75rem;
    color: var(--st-semantic-text-secondary, #475569);
  }
  .facet-hint {
    margin: 0;
    font-size: 0.75rem;
    color: var(--st-semantic-text-muted, #64748b);
  }
  .facet-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
  }
  .facet-error-actions {
    display: flex;
    gap: 0.375rem;
  }
</style>
