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
  let commandKey: string | null = null;
  let lastIntent: string | null = null;
  let pertinentCode = "";
  let watchingCode = "";
  let discardCode = "";

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
      pertinentCode = "";
      watchingCode = "";
      discardCode = "";
      await onSaved(action);
    } catch (err) {
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

</div>
