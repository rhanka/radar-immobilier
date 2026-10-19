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
</div>
