import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.useRealTimers(); });

async function readThrough(reader: ReadableStreamDefaultReader<Uint8Array>, marker: string): Promise<string> {
  let text = "";
  while (!text.includes(marker)) {
    const chunk = await reader.read();
    if (chunk.done) break;
    text += new TextDecoder().decode(chunk.value);
  }
  return text;
}

describe("6K SSE retirement", () => {
  it("should discard queued frames and close an existing connection at retirement", async () => {
    const bus = await import("../services/chat/stream-bus.js");
    const { chatRoute } = await import("./chat.js");
    await bus.publish("prospect-marks", "prospect:mark", { secret: "queued-mark" });
    await bus.publish("prospect-marks", "prospect:batch", { secret: "queued-batch" });
    const response = await chatRoute().request("/api/chat/streams/sse");
    const reader = response.body!.getReader();
    bus.retireLegacyMarkDelivery();
    await expect(reader.read()).rejects.toThrow("legacy_mark_delivery_retired");
    await bus.publish("prospect-marks", "prospect:mark", { secret: "late-mark" });
    await bus.publish("synthetic-chat", "text_delta", { text: "still available" });
    const reconnect = await chatRoute().request("/api/chat/streams/sse");
    const next = reconnect.body!.getReader();
    try {
      const text = new TextDecoder().decode((await next.read()).value);
      expect(text).toContain("still available");
      expect(text).not.toContain("prospect:mark");
      expect(text).not.toContain("prospect:batch");
    } finally { await next.cancel(); }
  });

  it.each(["publication", "heartbeat"])("should suspend mark delivery and recover it on the same connection via %s", async (trigger) => {
    const bus = await import("../services/chat/stream-bus.js");
    const { chatRoute } = await import("./chat.js");
    await bus.publish("prospect-marks", "prospect:mark", { secret: "suspended-mark" });
    await bus.publish("prospect-marks", "prospect:batch", { secret: "suspended-batch" });
    await bus.publish("synthetic-chat", "text_delta", { text: "chat remains" });
    const { lotCutoverState } = await import("../db/schema.js");
    let unavailable = true;
    const db = { select: () => {
      if (unavailable) throw new Error("database unavailable");
      return { from: async (table: unknown) => table === lotCutoverState ? [] : [{ enabled: false }] };
    } };
    vi.useFakeTimers();
    const response = await chatRoute(db as never).request("/api/chat/streams/sse");
    const reader = response.body!.getReader();
    try {
      const text = await readThrough(reader, "chat remains");
      expect(text).toContain("chat remains");
      expect(text).not.toContain("suspended-mark");
      expect(text).not.toContain("suspended-batch");
      expect(bus.isLegacyMarkDeliveryRetired()).toBe(false);
      await bus.publish("prospect-marks", "prospect:mark", { text: "withheld during outage" });
      await vi.advanceTimersByTimeAsync(0);
      await bus.publish("prospect-marks", "prospect:note", { text: "notes remain" });
      const outage = await readThrough(reader, "notes remain");
      expect(outage).not.toContain("withheld during outage");
      unavailable = false;
      if (trigger === "publication") {
        await bus.publish("prospect-marks", "prospect:mark", { text: "live after recovery" });
        await bus.publish("prospect-marks", "prospect:batch", { text: "batch after recovery" });
        await vi.advanceTimersByTimeAsync(0);
      } else {
        await vi.advanceTimersByTimeAsync(15000);
      }
      await bus.publish("synthetic-chat", "text_delta", { text: "recovery checked" });
      const recovered = await readThrough(reader, "recovery checked");
      expect(recovered.match(/suspended-mark/g)).toHaveLength(1);
      expect(recovered.match(/suspended-batch/g)).toHaveLength(1);
      expect(recovered.indexOf("suspended-mark")).toBeLessThan(recovered.indexOf("suspended-batch"));
      if (trigger === "publication") {
        expect(recovered.match(/live after recovery/g)).toHaveLength(1);
        expect(recovered.match(/batch after recovery/g)).toHaveLength(1);
      }
      await bus.publish("prospect-marks", "prospect:mark", { text: "direct mark" });
      await bus.publish("prospect-marks", "prospect:batch", { text: "direct batch" });
      await bus.publish("synthetic-chat", "text_delta", { text: "direct checked" });
      const direct = await readThrough(reader, "direct checked");
      expect(direct).toContain("direct mark");
      expect(direct).toContain("direct batch");
      expect(direct).not.toContain("suspended-");
      expect(bus.isLegacyMarkDeliveryRetired()).toBe(false);
    } finally { await reader.cancel(); }
  });

  it("should replay and deliver marks on a new connection after recovery", async () => {
    const bus = await import("../services/chat/stream-bus.js");
    const { chatRoute } = await import("./chat.js");
    const { lotCutoverState } = await import("../db/schema.js");
    let unavailable = true;
    const db = { select: () => {
      if (unavailable) throw new Error("database unavailable");
      return { from: async (table: unknown) => table === lotCutoverState ? [] : [{ enabled: false }] };
    } };
    await bus.publish("prospect-marks", "prospect:mark", { text: "replayed mark" });
    await bus.publish("prospect-marks", "prospect:batch", { text: "replayed batch" });
    await bus.publish("synthetic-chat", "text_delta", { text: "replay checked" });
    const first = await chatRoute(db as never).request("/api/chat/streams/sse");
    const firstReader = first.body!.getReader();
    unavailable = false;
    const reopened = await chatRoute(db as never).request("/api/chat/streams/sse");
    const next = reopened.body!.getReader();
    try {
      const replay = await readThrough(next, "replay checked");
      expect(replay.match(/replayed mark/g)).toHaveLength(1);
      expect(replay.match(/replayed batch/g)).toHaveLength(1);
      await bus.publish("prospect-marks", "prospect:mark", { text: "new live mark" });
      await bus.publish("prospect-marks", "prospect:batch", { text: "new live batch" });
      await bus.publish("synthetic-chat", "text_delta", { text: "new checked" });
      const direct = await readThrough(next, "new checked");
      expect(direct).toContain("new live mark");
      expect(direct).toContain("new live batch");
      expect(bus.isLegacyMarkDeliveryRetired()).toBe(false);
    } finally { await next.cancel(); await firstReader.cancel(); }
  });

  it.each(["open", "barrier"])("should retire a suspended connection when revalidation confirms %s", async (state) => {
    const bus = await import("../services/chat/stream-bus.js");
    const { chatRoute } = await import("./chat.js");
    let unavailable = true;
    const db = { select: () => {
      if (unavailable) throw new Error("database unavailable");
      return { from: async () => [{ destinationOpen: state === "open", maintenanceBarrier: true }] };
    } };
    await bus.publish("prospect-marks", "prospect:mark", { text: "withheld" });
    const response = await chatRoute(db as never).request("/api/chat/streams/sse");
    const reader = response.body!.getReader();
    unavailable = false;
    await bus.publish("prospect-marks", "prospect:batch", { text: "never delivered" });
    await expect(reader.read()).rejects.toThrow("legacy_mark_delivery_retired");
    expect(bus.isLegacyMarkDeliveryRetired()).toBe(true);
  });

  it.each(["open", "barrier"])("should retire preloaded replica buffers when durable state is %s", async (state) => {
    const bus = await import("../services/chat/stream-bus.js");
    const { chatRoute } = await import("./chat.js");
    await bus.publish("prospect-marks", "prospect:mark", { secret: "old-replica" });
    await bus.publish("prospect-marks", "prospect:batch", { secret: "old-batch" });
    await bus.publish("synthetic-chat", "text_delta", { text: "chat remains" });
    const db = { select: () => ({ from: async () =>
      [{ destinationOpen: state === "open", maintenanceBarrier: true }],
    }) };
    // The global feed has no workspace membership: a reconnecting outsider
    // must be unable to recover any retired mark, even from a fresh process.
    const response = await chatRoute(db as never).request("/api/chat/streams/sse");
    const reader = response.body!.getReader();
    try {
      const text = new TextDecoder().decode((await reader.read()).value);
      expect(text).toContain("chat remains");
      expect(text).not.toContain("prospect:mark");
      expect(text).not.toContain("prospect:batch");
      expect(bus.isLegacyMarkDeliveryRetired()).toBe(true);
    } finally { await reader.cancel(); }
  });
});
