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
const FINGERPRINT = "0123456789abcdef".repeat(4);

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
  codesLoading?: boolean;
  disabled?: boolean;
  displayedFingerprint?: string | null;
  postCommand?: ReturnType<typeof postCommandMock>;
  onSaved?: (action: FacetAction) => void;
  onRetryCodes?: () => void;
} = {}) {
  const postCommand = options.postCommand ?? postCommandMock();
  const onSaved = options.onSaved ?? vi.fn();
  const onRetryCodes = options.onRetryCodes ?? vi.fn();
  const view = render(SignalFacetControls, {
    props: {
      target: TARGET,
      state: options.state ?? emptyTargetFacetState(),
      codes: options.codes === undefined ? CODES : options.codes,
      codesError: options.codesError ?? null,
      codesLoading: options.codesLoading ?? false,
      disabled: options.disabled ?? false,
      displayedFingerprint: options.displayedFingerprint === undefined ? FINGERPRINT : options.displayedFingerprint,
      postCommand,
      onSaved,
      onRetryCodes,
    },
  });
  return { view, postCommand, onSaved: onSaved as ReturnType<typeof vi.fn>, onRetryCodes: onRetryCodes as ReturnType<typeof vi.fn> };
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

  it("should name each basket group and its otherwise duplicate actions", () => {
    renderControls();
    expect(within(screen.getByRole("group", { name: "Pertinent" })).getByRole("button", { name: "Ajouter au panier Pertinent" })).toBeTruthy();
    expect(within(screen.getByRole("group", { name: "À surveiller" })).getByRole("button", { name: "Ajouter au panier À surveiller" })).toBeTruthy();
    expect(within(screen.getByRole("group", { name: "Écarter" })).getByRole("button", { name: "Valider l'écart du signal" })).toBeTruthy();
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
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("discard", { viewerKey: null, displayedFingerprint: FINGERPRINT, confirmedHeadId: null }));
    expect(postCommand).toHaveBeenCalledTimes(1);
    expect(postCommand.mock.calls[0]![1]).toBe("discard");
    expect(postCommand.mock.calls[0]![2]).toEqual({ target: TARGET, reasonCode: "N-ADMIN",
      expectedHeadId: null, displayedFingerprint: FINGERPRINT });
  });

  it.each([401, 403, 404, 409, 422])("should reject %s without retrying a refused intention", async (status) => {
    const postCommand = postCommandMock();
    postCommand.mockRejectedValueOnce(new SignalFacetError(status, "invalid_reason_code"));
    const { onSaved } = renderControls({ postCommand });
    await fireEvent.change(screen.getByLabelText("Code de motif (requis) — Écarter"), {
      target: { value: "P-BIDON" },
    });
    await fireEvent.click(screen.getByTestId("facet-discard-submit"));
    await screen.findByText("Écriture refusée");
    if (status === 422) expect(screen.getByText(/Code invalide/)).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.queryByTestId("facet-retry")).toBeNull();
    await fireEvent.click(screen.getByTestId("facet-discard-submit"));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("discard", { viewerKey: null, displayedFingerprint: FINGERPRINT, confirmedHeadId: null }));
    expect(postCommand).toHaveBeenCalledTimes(2);
    expect(postCommand.mock.calls[0]![3]).not.toBe(postCommand.mock.calls[1]![3]);
  });
});

describe("SignalFacetControls — baskets and restoration", () => {
  it.each([new SignalFacetError(null, null), new TypeError("fetch failed"), new SignalFacetError(503, "unavailable")])(
    "should label an unconfirmed write without a refusal: %s",
    async (failure) => {
      const postCommand = postCommandMock();
      postCommand.mockRejectedValueOnce(failure);
      const { onSaved } = renderControls({ postCommand });
      await fireEvent.click(screen.getByTestId("facet-toggle-pertinent"));
      await screen.findByText("Écriture non confirmée — Réessayer.");
      expect(screen.queryByText("Écriture refusée")).toBeNull();
      expect(onSaved).not.toHaveBeenCalled();
      expect(screen.queryByTestId("facet-state-pertinent")).toBeNull();
      await fireEvent.click(screen.getByTestId("facet-retry"));
      await waitFor(() => expect(onSaved).toHaveBeenCalledWith("select", { viewerKey: null, displayedFingerprint: FINGERPRINT, confirmedHeadId: null }));
      expect(postCommand.mock.calls[0]![3]).toBe(postCommand.mock.calls[1]![3]);
    },
  );

  it("keeps controls inactive until the confirmed write has been reloaded", async () => {
    let finishReload!: () => void;
    const reloaded = new Promise<void>((resolve) => { finishReload = resolve; });
    const onSaved = vi.fn(() => reloaded);
    renderControls({ onSaved });
    await fireEvent.click(screen.getByTestId("facet-toggle-pertinent"));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect((screen.getByTestId("facet-toggle-watching") as HTMLButtonElement).disabled).toBe(true);
    finishReload();
    await waitFor(() => expect((screen.getByTestId("facet-toggle-watching") as HTMLButtonElement).disabled).toBe(false));
  });

  it("adds to a basket with an optional code", async () => {
    const { postCommand, onSaved } = renderControls();
    await fireEvent.change(screen.getByLabelText("Code (facultatif) — Pertinent"), {
      target: { value: "P-DENSITE" },
    });
    await fireEvent.click(screen.getByTestId("facet-toggle-pertinent"));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("select", { viewerKey: null, displayedFingerprint: FINGERPRINT, confirmedHeadId: null }));
    expect(postCommand.mock.calls[0]![2]).toEqual({
      target: TARGET,
      basket: "pertinent",
      reasonCode: "P-DENSITE",
      expectedHeadId: null,
      displayedFingerprint: FINGERPRINT,
    });
  });

  it("offers removal or a code change on an active basket", async () => {
    const { postCommand } = renderControls({
      state: { ...emptyTargetFacetState(), pertinent: true, pertinentCode: "P-DENSITE", pertinentHeadId: "head-1" },
    });
    expect(screen.getByTestId("facet-state-pertinent").textContent).toContain("P-DENSITE");
    await fireEvent.click(screen.getByTestId("facet-toggle-pertinent"));
    await waitFor(() => expect(postCommand).toHaveBeenCalledTimes(1));
    expect(postCommand.mock.calls[0]![1]).toBe("deselect");
    expect(postCommand.mock.calls[0]![2]).toEqual({ target: TARGET, basket: "pertinent",
      expectedHeadId: "head-1", displayedFingerprint: FINGERPRINT });
  });

  it.each(["pertinent", "a_surveiller"] as const)("clears the optional code in %s without removing the basket", async (basket) => {
    const watching = basket === "a_surveiller";
    const { postCommand } = renderControls({ state: {
      ...emptyTargetFacetState(),
      pertinent: !watching, pertinentCode: watching ? null : "P-DENSITE",
      watching, watchingCode: watching ? "N-LEURRE" : null,
    } });
    const update = screen.getByTestId(watching ? "facet-update-watching-code" : "facet-update-pertinent-code") as HTMLButtonElement;
    const select = screen.getByLabelText(`Code (facultatif) — ${watching ? "À surveiller" : "Pertinent"}`) as HTMLSelectElement;
    expect(select.value).toBe(watching ? "N-LEURRE" : "P-DENSITE");
    expect(update.disabled).toBe(true);
    await fireEvent.change(select, { target: { value: "" } });
    expect(update.disabled).toBe(false);
    await fireEvent.click(update);
    await waitFor(() => expect(postCommand).toHaveBeenCalled());
    expect(postCommand.mock.calls[0]!.slice(1, 3)).toEqual(["select", { target: TARGET, basket,
      expectedHeadId: null, displayedFingerprint: FINGERPRINT }]);
  });

  it("should resynchronize both selected codes when heads change", async () => {
    const { view } = renderControls();
    await view.rerender({ state: {
      ...emptyTargetFacetState(), pertinent: true, pertinentCode: "P-DENSITE",
      watching: true, watchingCode: "S-VEILLE",
    } });
    expect((screen.getByLabelText("Code (facultatif) — Pertinent") as HTMLSelectElement).value).toBe("P-DENSITE");
    expect((screen.getByLabelText("Code (facultatif) — À surveiller") as HTMLSelectElement).value).toBe("S-VEILLE");
    expect((screen.getByTestId("facet-update-pertinent-code") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("facet-update-watching-code") as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows Restaurer instead of the discard form on an archived signal", async () => {
    const { postCommand, onSaved } = renderControls({
      state: {
        ...emptyTargetFacetState(),
        archived: true,
        archiveCode: "N-ADMIN",
        archiveHeadId: "archive-1",
        changedSinceArchive: true,
      },
    });
    expect(screen.queryByTestId("facet-discard-submit")).toBeNull();
    await fireEvent.click(screen.getByTestId("facet-restore"));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("restore", { viewerKey: null, displayedFingerprint: FINGERPRINT, confirmedHeadId: null }));
    expect(postCommand.mock.calls[0]![1]).toBe("restore");
    expect(postCommand.mock.calls[0]![2]).toEqual({ target: TARGET, expectedHeadId: "archive-1",
      displayedFingerprint: FINGERPRINT });
  });

  it("inactivates every control when codes are unreadable", () => {
    renderControls({ codes: null, codesError: "Codes de motif illisibles (test)." });
    expect(screen.getByText(/Codes de motif illisibles/)).toBeTruthy();
    for (const testId of ["facet-toggle-pertinent", "facet-toggle-watching"]) {
      expect((screen.getByTestId(testId) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("shows a distinct loading label while codes load, without claiming failure", () => {
    renderControls({ codes: null, codesLoading: true });
    expect(screen.getByText("Chargement des codes…")).toBeTruthy();
    expect(screen.queryByText(/illisibles/)).toBeNull();
    expect(screen.queryByTestId("facet-retry-codes")).toBeNull();
    expect((screen.getByTestId("facet-toggle-pertinent") as HTMLButtonElement).disabled).toBe(true);
  });

  it("offers a codes-only retry after a real codebook failure", async () => {
    const onRetryCodes = vi.fn();
    renderControls({ codes: null, codesError: "Codes de motif illisibles (test).", onRetryCodes });
    await fireEvent.click(screen.getByTestId("facet-retry-codes"));
    expect(onRetryCodes).toHaveBeenCalledTimes(1);
  });

  it("keeps focus inside the controls after a select write and reload", async () => {
    const { onSaved } = renderControls();
    await fireEvent.click(screen.getByTestId("facet-toggle-pertinent"));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("select", { viewerKey: null, displayedFingerprint: FINGERPRINT, confirmedHeadId: null }));
    await waitFor(() =>
      expect(screen.getByTestId("signal-facet-controls").contains(document.activeElement)).toBe(true),
    );
  });

  it("focuses a fallback control when a code change disables its trigger", async () => {
    const extended: ReasonCode[] = [...CODES, { code: "P-NEW", verdict: "pertinent" }];
    const postCommand = postCommandMock(async () => null);
    const onSaved = vi.fn(async (): Promise<void> => {
      await view.rerender({
        state: { ...emptyTargetFacetState(), pertinent: true, pertinentCode: "P-NEW", pertinentHeadId: "head-new" },
        codes: extended,
      });
    });
    const view = render(SignalFacetControls, {
      props: {
        target: TARGET,
        state: { ...emptyTargetFacetState(), pertinent: true, pertinentCode: "P-DENSITE", pertinentHeadId: "head-1" },
        codes: extended,
        codesError: null,
        codesLoading: false,
        disabled: false,
        displayedFingerprint: FINGERPRINT,
        postCommand,
        onSaved,
        onRetryCodes: vi.fn(),
      },
    });
    await fireEvent.change(screen.getByLabelText("Code (facultatif) — Pertinent"), {
      target: { value: "P-NEW" },
    });
    const trigger = screen.getByTestId("facet-update-pertinent-code") as HTMLButtonElement;
    expect(trigger.disabled).toBe(false);
    trigger.focus();
    await fireEvent.click(trigger);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        (screen.getByTestId("facet-update-pertinent-code") as HTMLButtonElement).disabled,
      ).toBe(true),
    );
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    expect(screen.getByTestId("signal-facet-controls").contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(trigger);
    expect((document.activeElement as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("SignalFacetControls — expected heads (6A)", () => {
  it("sends the inactive archive head on a new discard instead of null", async () => {
    const { postCommand } = renderControls({
      state: { ...emptyTargetFacetState(), archiveHeadId: "archive-old" },
    });
    await fireEvent.change(screen.getByLabelText("Code de motif (requis) — Écarter"), {
      target: { value: "N-ADMIN" },
    });
    await fireEvent.click(screen.getByTestId("facet-discard-submit"));
    await waitFor(() => expect(postCommand).toHaveBeenCalledTimes(1));
    expect(postCommand.mock.calls[0]![2]).toMatchObject({ expectedHeadId: "archive-old" });
  });

  it("surfaces a head conflict distinctly and asks the parent to reload", async () => {
    const postCommand = postCommandMock();
    postCommand.mockRejectedValueOnce(new SignalFacetError(409, "facet_head_conflict", undefined, { version: null, heads: [] }));
    const onHeadsStale = vi.fn();
    render(SignalFacetControls, {
      props: {
        target: TARGET,
        state: emptyTargetFacetState(),
        codes: CODES,
        codesError: null,
        codesLoading: false,
        disabled: false,
        displayedFingerprint: FINGERPRINT,
        postCommand,
        onSaved: vi.fn(),
        onRetryCodes: vi.fn(),
        onHeadsStale,
      },
    });
    await fireEvent.click(screen.getByTestId("facet-toggle-pertinent"));
    await screen.findByText("Écriture refusée");
    expect(screen.getByText(/Données périmées/)).toBeTruthy();
    expect(screen.queryByTestId("facet-retry")).toBeNull();
    expect(onHeadsStale).toHaveBeenCalledTimes(1);
    expect(onHeadsStale.mock.calls[0]![0]).toEqual(TARGET);
    expect(onHeadsStale.mock.calls[0]![1]).toEqual({ viewerKey: null, displayedFingerprint: FINGERPRINT });
    expect(onHeadsStale.mock.calls[0]![2]).toMatch(/Données périmées/);
  });
});

describe("SignalFacetControls — displayed fingerprint (6B)", () => {
  it("keeps the original payload and key on a network retry after display changes", async () => {
    const postCommand = postCommandMock();
    postCommand.mockRejectedValueOnce(new SignalFacetError(null, null));
    const { view } = renderControls({ postCommand });
    await fireEvent.click(screen.getByTestId("facet-toggle-pertinent"));
    await screen.findByTestId("facet-retry");
    await view.rerender({ displayedFingerprint: "b".repeat(64) });
    await fireEvent.click(screen.getByTestId("facet-retry"));
    await waitFor(() => expect(postCommand).toHaveBeenCalledTimes(2));
    expect(postCommand.mock.calls[1]).toEqual(postCommand.mock.calls[0]);
  });

  it("sends the captured fingerprint with every action", async () => {
    const { postCommand } = renderControls();
    await fireEvent.click(screen.getByTestId("facet-toggle-pertinent"));
    await waitFor(() => expect(postCommand).toHaveBeenCalledTimes(1));
    expect(postCommand.mock.calls[0]![2]).toMatchObject({ displayedFingerprint: FINGERPRINT });
  });

  it("surfaces a version conflict distinctly and asks the parent to reload", async () => {
    const postCommand = postCommandMock();
    postCommand.mockRejectedValueOnce(new SignalFacetError(409, "target_version_conflict", undefined,
      { version: { fingerprint: "f".repeat(64) }, heads: [] }));
    const onHeadsStale = vi.fn();
    const onSaved = vi.fn();
    render(SignalFacetControls, {
      props: {
        target: TARGET,
        state: emptyTargetFacetState(),
        codes: CODES,
        codesError: null,
        codesLoading: false,
        disabled: false,
        displayedFingerprint: FINGERPRINT,
        postCommand,
        onSaved,
        onRetryCodes: vi.fn(),
        onHeadsStale,
      },
    });
    await fireEvent.click(screen.getByTestId("facet-toggle-pertinent"));
    await screen.findByText("Écriture refusée");
    expect(screen.getByText(/Contenu modifié/)).toBeTruthy();
    expect(screen.queryByTestId("facet-retry")).toBeNull();
    expect(onHeadsStale).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("inactivates every control without a displayed fingerprint", async () => {
    const { postCommand } = renderControls({ displayedFingerprint: null });
    for (const testId of ["facet-toggle-pertinent", "facet-toggle-watching"]) {
      expect((screen.getByTestId(testId) as HTMLButtonElement).disabled).toBe(true);
    }
    expect((screen.getByTestId("facet-discard-submit") as HTMLButtonElement).disabled).toBe(true);
    expect(postCommand).not.toHaveBeenCalled();
  });
});
