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
  import { Alert, Button, Select } from "@sentropic/design-system-svelte";
  import {
    codesForVerdict,
    createCommandKey,
    facetErrorMessage,
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

  async function run(action: FacetAction, body: FacetCommandBody): Promise<void> {
    const intent = JSON.stringify([action, body]);
    // One key per intention, reused when retrying the same intention.
    if (lastIntent !== intent) {
      commandKey = createCommandKey();
      lastIntent = intent;
    }
    busy = true;
    error = null;
    try {
      await postCommand("", action, body, commandKey!);
      commandKey = null;
      lastIntent = null;
      discardCode = "";
      await onSaved(action);
    } catch (err) {
      unconfirmed = !(err instanceof SignalFacetError) || err.status === null;
      error =
        err instanceof SignalFacetError
          ? facetErrorMessage(err)
          : "Écriture non confirmée — Réessayer.";
    } finally {
      busy = false;
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

<div class="facet-controls" data-testid="signal-facet-controls" data-target={describeTarget()}>
  {#if !codesReady}
    <Alert
      tone="info"
      title="Classement indisponible"
      message={codesError ?? "Codes de motif illisibles — réessayez le chargement de la ville."}
    />
  {/if}

  {#if error}
    <Alert tone="error" title={unconfirmed ? "Écriture non confirmée" : "Écriture refusée"} message={error} />
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

  <div class="facet-baskets">
    <div class="facet-row" data-testid="facet-row-pertinent">
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
            data-testid="facet-toggle-pertinent"
          >
            Ajouter
          </Button>
        </div>
      {/if}
    </div>

    <div class="facet-row" data-testid="facet-row-watching">
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
            data-testid="facet-toggle-watching"
          >
            Ajouter
          </Button>
        </div>
      {/if}
    </div>
  </div>

  <div class="facet-archive" data-testid="facet-row-archive">
    {#if state.archived}
      <span class="facet-name">Écarté{#if state.archiveCode} · {state.archiveCode}{/if}</span>
      <div class="facet-actions">
        <Button
          variant="secondary"
          size="sm"
          type="button"
          disabled={inactive}
          onclick={() => run("restore", { target })}
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
    border-top: 1px solid rgb(226 232 240);
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
    color: rgb(51 65 85);
  }
  .facet-state {
    font-size: 0.75rem;
    color: rgb(71 85 105);
  }
  .facet-hint {
    margin: 0;
    font-size: 0.75rem;
    color: rgb(100 116 139);
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
