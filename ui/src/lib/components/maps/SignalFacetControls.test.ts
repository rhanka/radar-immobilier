/**
 * Component tests for SignalFacetControls (lot 4, C4).
 *
 * Synthetic taxonomy only: prefixes deliberately contradict verdicts, so the
 * option lists prove exact-verdict filtering. No MapLibre, no API: the facet
 * POST is injected.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/svelte";
import SignalFacetControls from "./SignalFacetControls.svelte";
import { emptyTargetFacetState, SignalFacetError, type FacetAction, type ReasonCode, type TargetFacetState } from "$lib/signals/signal-facets-client.js";

const TARGET = { citySlug: "ville-synth", type: "Signal" as const, id: "sig-1" };

/** Prefixes contradict verdicts on purpose: filtering must follow verdict. */
const CODES: ReasonCode[] = [
  { code: "P-DENSITE", verdict: "pertinent" },
  { code: "P-BIDON", verdict: "non_pertinent" },
  { code: "N-ADMIN", verdict: "non_pertinent" },
  { code: "N-LEURRE", verdict: "a_surveiller" },
  { code: "S-VEILLE", verdict: "a_surveiller" },
];

function postCommandMock(impl: (...args: unknown[]) => Promise<unknown> = async () => null) {
  return vi.fn(impl);
}

function renderControls(options: {
  state?: TargetFacetState;
  codes?: ReasonCode[] | null;
  codesError?: string | null;
  postCommand?: ReturnType<typeof postCommandMock>;
  onSaved?: (action: FacetAction) => void;
} = {}) {
  const postCommand = options.postCommand ?? postCommandMock();
  const onSaved = options.onSaved ?? vi.fn();
  render(SignalFacetControls, {
    props: {
      target: TARGET,
      state: options.state ?? emptyTargetFacetState(),
      codes: options.codes === undefined ? CODES : options.codes,
      codesError: options.codesError ?? null,
      postCommand,
      onSaved,
    },
  });
  return { postCommand, onSaved: onSaved as ReturnType<typeof vi.fn> };
}

function optionsOf(label: string): string[] {
  const select = screen.getByLabelText(label) as HTMLSelectElement;
  return within(select).getAllByRole("option").map((opt) => (opt as HTMLOptionElement).value);
}

afterEach(() => cleanup());

describe("SignalFacetControls — verdict-filtered code lists", () => {
  it("filters every Select on the exact verdict, never on the prefix", () => {
    renderControls();
    expect(optionsOf("Code (facultatif) — Pertinent")).toEqual(["", "P-DENSITE"]);
    expect(optionsOf("Code (facultatif) — À surveiller")).toEqual(["", "N-LEURRE", "S-VEILLE"]);
    expect(optionsOf("Code de motif (requis) — Écarter")).toEqual(["", "P-BIDON", "N-ADMIN"]);
  });

  it("renders codes verbatim", () => {
    renderControls();
    const select = screen.getByLabelText("Code de motif (requis) — Écarter");
    expect(within(select).getByRole("option", { name: "P-BIDON" })).toBeTruthy();
  });
});

describe("SignalFacetControls — discard requires a code", () => {
  it("keeps Valider inactive without a code and discards without deselect", async () => {
    const { postCommand, onSaved } = renderControls();
    const submit = screen.getByTestId("facet-discard-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    const select = screen.getByLabelText("Code de motif (requis) — Écarter");
    await fireEvent.change(select, { target: { value: "N-ADMIN" } });
    expect(submit.disabled).toBe(false);
    await fireEvent.click(submit);
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("discard"));
    expect(postCommand).toHaveBeenCalledTimes(1);
    expect(postCommand.mock.calls[0]![1]).toBe("discard");
    expect(postCommand.mock.calls[0]![2]).toEqual({ target: TARGET, reasonCode: "N-ADMIN" });
  });

  it("shows a 422 failure, keeps the previous state, and retries with the same key", async () => {
    const postCommand = postCommandMock();
    postCommand.mockRejectedValueOnce(new SignalFacetError(422, "invalid_reason_code"));
    const { onSaved } = renderControls({ postCommand });
    await fireEvent.change(screen.getByLabelText("Code de motif (requis) — Écarter"), {
      target: { value: "P-BIDON" },
    });
    await fireEvent.click(screen.getByTestId("facet-discard-submit"));
    await waitFor(() => expect(screen.getByText(/Code invalide/)).toBeTruthy());
    expect(onSaved).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByTestId("facet-retry"));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("discard"));
    expect(postCommand).toHaveBeenCalledTimes(2);
    expect(postCommand.mock.calls[0]![3]).toBe(postCommand.mock.calls[1]![3]);
  });
});

