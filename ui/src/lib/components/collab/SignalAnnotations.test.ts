/**
 * SignalAnnotations (container) — test : câblage client↔présentiel. Mock du
 * client `annotations-client` ; vérifie charge-au-montage, add→create+refetch,
 * et la notification onCount.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/svelte";

vi.mock("$lib/collab/annotations-client.js", () => ({
  listAnnotations: vi.fn(),
  createAnnotation: vi.fn(),
  editAnnotation: vi.fn(),
  deleteAnnotation: vi.fn(),
}));

// Mock du flux SSE : capture le handler de frame passé par onMount, garde le
// vrai `noteMatchesTarget` (logique de match signal/lot).
const streamMock = vi.hoisted(() => ({ handlers: [] as Array<(f: unknown) => void> }));
vi.mock("$lib/collab/prospect-notes-stream.js", () => ({
  subscribeNoteFrames: (onFrame: (f: unknown) => void) => {
    streamMock.handlers.push(onFrame);
    return () => {};
  },
  noteMatchesTarget: (
    note: { targetType: string; signalId?: string; noLot?: string; citySlug?: string },
    target: { type: string; id: string; citySlug: string },
  ): boolean =>
    note.targetType === target.type &&
    (target.type === "signal"
      ? note.signalId === target.id
      : note.noLot === target.id && note.citySlug === target.citySlug),
}));

import SignalAnnotations from "./SignalAnnotations.svelte";
import { listAnnotations, createAnnotation } from "$lib/collab/annotations-client.js";
import type { AnnotationTarget, EntityAnnotation } from "$lib/collab/annotation.js";

const list = listAnnotations as unknown as ReturnType<typeof vi.fn>;
const create = createAnnotation as unknown as ReturnType<typeof vi.fn>;

const TARGET: AnnotationTarget = { type: "signal", id: "sig-1", citySlug: "delson" };
const NOTES: EntityAnnotation[] = [
  { id: "n1", body: "note existante", authorId: "me", authorName: "Moi", createdAt: "2026-01-01T00:00:00Z" },
];

afterEach(() => cleanup());
beforeEach(() => {
  vi.clearAllMocks();
  streamMock.handlers.length = 0;
  list.mockResolvedValue(NOTES);
  create.mockResolvedValue(undefined);
});

describe("SignalAnnotations (container)", () => {
  it("charge les notes de la cible au montage", async () => {
    const { getByTestId } = render(SignalAnnotations, { props: { target: TARGET, currentUserId: "me" } });
    await waitFor(() => expect(list).toHaveBeenCalledWith(TARGET));
    await waitFor(() => expect(getByTestId("annotations-count").textContent).toBe("1"));
  });

  it("Ajouter → createAnnotation(target, body) puis refetch (canonise sur GET)", async () => {
    const { getByTestId } = render(SignalAnnotations, { props: { target: TARGET, currentUserId: "me" } });
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    await fireEvent.input(getByTestId("annotation-new"), { target: { value: "nouvelle" } });
    await fireEvent.click(getByTestId("annotation-add"));
    await waitFor(() => expect(create).toHaveBeenCalledWith(TARGET, "nouvelle"));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });

  it("onCount notifié du nombre de notes chargées", async () => {
    const onCount = vi.fn();
    render(SignalAnnotations, { props: { target: TARGET, currentUserId: "me", onCount } });
    await waitFor(() => expect(onCount).toHaveBeenCalledWith(1));
  });

  it("temps réel : une frame prospect:note concernant la cible déclenche un refetch", async () => {
    render(SignalAnnotations, { props: { target: TARGET, currentUserId: "me" } });
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    expect(streamMock.handlers).toHaveLength(1);

    // frame d'un coéquipier sur CE signal → refetch
    streamMock.handlers[0]!({ action: "add", note: { id: "n2", targetType: "signal", signalId: "sig-1" } });
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });

  it("temps réel : une frame concernant une AUTRE cible est ignorée (pas de refetch)", async () => {
    render(SignalAnnotations, { props: { target: TARGET, currentUserId: "me" } });
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));

    streamMock.handlers[0]!({ action: "add", note: { id: "x", targetType: "signal", signalId: "autre-signal" } });
    streamMock.handlers[0]!({ action: "add", note: { id: "y", targetType: "lot", noLot: "1234567", citySlug: "delson" } });
    // laisse une microtâche s'écouler : aucun refetch supplémentaire
    await Promise.resolve();
    expect(list).toHaveBeenCalledTimes(1);
  });
});
