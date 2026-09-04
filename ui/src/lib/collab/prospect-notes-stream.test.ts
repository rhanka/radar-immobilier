/**
 * prospect-notes-stream — test unitaire (mock `getStreamHub`). Vérifie :
 * abonnement sur le stream `prospect-marks`, filtrage `prospect:note` (les
 * autres events ignorés), formes mal formées rejetées, clés uniques par
 * abonnement, désabonnement (`hub.delete`), et le match de cible signal/lot.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Handler = (event: unknown) => void;
const hub = {
  setStream: vi.fn(),
  delete: vi.fn(),
};

vi.mock("$lib/chat/chat-client.js", () => ({
  getStreamHub: () => hub,
}));

import {
  subscribeNoteFrames,
  noteMatchesTarget,
  PROSPECT_STREAM_ID,
  type ProspectNoteFrame,
} from "./prospect-notes-stream.js";
import type { AnnotationTarget } from "./annotation.js";

/** Récupère (key, streamId, onEvent) du n-ième abonnement. */
function subAt(i = 0): { key: string; streamId: string; onEvent: Handler } {
  const [key, streamId, onEvent] = hub.setStream.mock.calls[i]! as [string, string, Handler];
  return { key, streamId, onEvent };
}

function frame(action: ProspectNoteFrame["action"], note: Partial<ProspectNoteFrame["note"]>): unknown {
  return { type: "prospect:note", streamId: PROSPECT_STREAM_ID, sequence: 1, data: { action, note } };
}

const SIGNAL: AnnotationTarget = { type: "signal", id: "sig-1", citySlug: "delson" };
const LOT: AnnotationTarget = { type: "lot", id: "1234567", citySlug: "delson" };

beforeEach(() => {
  hub.setStream.mockReset();
  hub.delete.mockReset();
});

describe("subscribeNoteFrames", () => {
  it("s'abonne au stream prospect-marks et relaie les frames prospect:note bien formées", () => {
    const onFrame = vi.fn();
    subscribeNoteFrames(onFrame);
    const { streamId, onEvent } = subAt();
    expect(streamId).toBe(PROSPECT_STREAM_ID);

    onEvent(frame("add", { id: "n1", targetType: "signal", signalId: "sig-1" }));
    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(onFrame.mock.calls[0]![0]).toMatchObject({ action: "add", note: { id: "n1", targetType: "signal" } });
  });

  it("ignore les autres events du même stream (prospect:mark, ping) et les data mal formées", () => {
    const onFrame = vi.fn();
    subscribeNoteFrames(onFrame);
    const { onEvent } = subAt();

    onEvent({ type: "prospect:mark", streamId: PROSPECT_STREAM_ID, sequence: 2, data: { noLot: "x" } });
    onEvent({ type: "ping", data: {} });
    onEvent(frame("add", { targetType: "signal" })); // note.id manquant → rejetée
    onEvent({ type: "prospect:note", streamId: PROSPECT_STREAM_ID, sequence: 3, data: { action: "bogus", note: { id: "n", targetType: "lot" } } });
    onEvent({ type: "prospect:note", streamId: PROSPECT_STREAM_ID, sequence: 4, data: null });

    expect(onFrame).not.toHaveBeenCalled();
  });

  it("attribue une clé unique par abonnement et désabonne via hub.delete", () => {
    const un1 = subscribeNoteFrames(vi.fn());
    const un2 = subscribeNoteFrames(vi.fn());
    const k1 = subAt(0).key;
    const k2 = subAt(1).key;
    expect(k1).not.toBe(k2);

    un1();
    expect(hub.delete).toHaveBeenCalledWith(k1);
    un2();
    expect(hub.delete).toHaveBeenCalledWith(k2);
  });
});

describe("noteMatchesTarget", () => {
  it("signal : match sur signalId, même targetType", () => {
    expect(noteMatchesTarget({ id: "n", targetType: "signal", signalId: "sig-1" }, SIGNAL)).toBe(true);
    expect(noteMatchesTarget({ id: "n", targetType: "signal", signalId: "autre" }, SIGNAL)).toBe(false);
  });

  it("lot : match sur noLot + citySlug", () => {
    expect(noteMatchesTarget({ id: "n", targetType: "lot", noLot: "1234567", citySlug: "delson" }, LOT)).toBe(true);
    expect(noteMatchesTarget({ id: "n", targetType: "lot", noLot: "1234567", citySlug: "autre" }, LOT)).toBe(false);
    expect(noteMatchesTarget({ id: "n", targetType: "lot", noLot: "999", citySlug: "delson" }, LOT)).toBe(false);
  });

  it("type de cible différent → jamais de match", () => {
    expect(noteMatchesTarget({ id: "n", targetType: "lot", noLot: "1234567", citySlug: "delson" }, SIGNAL)).toBe(false);
    expect(noteMatchesTarget({ id: "n", targetType: "signal", signalId: "sig-1" }, LOT)).toBe(false);
  });
});
