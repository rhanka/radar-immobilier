import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { tick } from "svelte";
import SignalFacetControls from "./SignalFacetControls.svelte";
import { emptyTargetFacetState, SignalFacetError, type FacetAction, type FacetCommandPoster } from "$lib/signals/signal-facets-client.js";

afterEach(cleanup);

const actions: FacetAction[] = ["select", "deselect", "discard", "restore"];

describe("SignalFacetControls — late viewer commands", () => {
  it.each(actions.flatMap((action) => [false, true].map((fails) => ({ action, fails }))))(
    "ignores stale $action effects and consumes its key (failure: $fails)",
    async ({ action, fails }) => {
      let resolve!: () => void;
      let reject!: (error: unknown) => void;
      const pending = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
      const postCommand = vi.fn<FacetCommandPoster>(async () => null);
      postCommand.mockImplementationOnce(() => pending);
      const onSaved = vi.fn();
      const state = emptyTargetFacetState();
      state.pertinent = action === "deselect";
      state.archived = action === "restore";
      const view = render(SignalFacetControls, { props: {
        target: { citySlug: "test-city", type: "Signal", id: "sig-1" },
        state,
        displayedFingerprint: "a".repeat(64),
        codes: [{ code: "N-ADMIN", verdict: "non_pertinent" }],
        viewerKey: { context: "account-a/true" },
        postCommand,
        onSaved,
      } });
      const trigger = screen.getByTestId(action === "discard" ? "facet-discard-submit"
        : action === "restore" ? "facet-restore" : "facet-toggle-pertinent") as HTMLButtonElement;
      if (action === "discard") {
        await fireEvent.change(screen.getByLabelText("Code de motif (requis) — Écarter"), {
          target: { value: "N-ADMIN" },
        });
      }
      trigger.focus();
      await fireEvent.click(trigger);
      expect(postCommand).toHaveBeenCalledTimes(1);
      // A new context identity also covers signing back in as the same sub.
      const viewerKey = { context: "account-a/true" };
      await view.rerender({ viewerKey });
      const focusSink = document.createElement("button");
      document.body.append(focusSink);
      focusSink.focus();
      focusSink.remove();
      expect(document.activeElement).toBe(document.body);
      if (fails) reject(new SignalFacetError(null, null));
      else resolve();
      await waitFor(() => expect(trigger.disabled).toBe(false));
      await tick();
      expect(onSaved).not.toHaveBeenCalled();
      expect(screen.queryByText(/Écriture non confirmée|Écriture refusée/)).toBeNull();
      expect(screen.queryByTestId("facet-retry")).toBeNull();
      expect(document.activeElement).toBe(document.body);
      await fireEvent.click(trigger);
      await waitFor(() => expect(onSaved).toHaveBeenCalledWith(action, expect.objectContaining({ viewerKey })));
      const calls = postCommand.mock.calls;
      expect(calls[1]![2]).not.toBe(calls[0]![2]);
    },
  );
});
