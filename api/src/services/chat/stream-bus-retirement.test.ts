/**
 * 6K legacy delivery retirement: retired mark/batch frames never reach
 * new or reconnecting subscribers, while notes keep flowing.
 * In-memory only; no database, no network.
 */
import { describe, expect, it } from "vitest";
import {
  isLegacyMarkDeliveryRetired,
  isStreamTypeRetired,
  publish,
  replayAll,
  retireLegacyMarkDelivery,
  retireStreamTypes,
  type StreamFrame,
} from "./stream-bus.js";

describe("6K legacy delivery retirement", () => {
  it("should retire mark and batch frames while notes keep flowing", async () => {
    const stream = "synthetic-6k-retirement";
    await publish(stream, "prospect:mark", { mark: 1 });
    await publish(stream, "prospect:batch", { batch: 1 });
    await publish(stream, "prospect:note", { note: 1 });
    retireStreamTypes(stream, ["prospect:mark", "prospect:batch"]);
    const dropped = await publish(stream, "prospect:mark", { mark: 2 });
    expect(dropped.streamId).toBe(stream);
    await publish(stream, "prospect:note", { note: 2 });
    const replayed: StreamFrame[] = [];
    replayAll((frame) => {
      if (frame.streamId === stream) replayed.push(frame);
    });
    expect(replayed.map((frame) => frame.data)).toEqual([{ note: 1 }, { note: 2 }]);
    expect(isStreamTypeRetired(stream, "prospect:mark")).toBe(true);
    expect(isStreamTypeRetired(stream, "prospect:note")).toBe(false);
  });

  it("should retire the shared prospect stream exactly once", () => {
    expect(isLegacyMarkDeliveryRetired()).toBe(false);
    retireLegacyMarkDelivery();
    retireLegacyMarkDelivery();
    expect(isLegacyMarkDeliveryRetired()).toBe(true);
  });
});
