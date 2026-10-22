import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => { vi.resetModules(); });

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

  it.each(["open", "barrier", "unreadable"])("should retire preloaded replica buffers when durable state is %s", async (state) => {
    const bus = await import("../services/chat/stream-bus.js");
    const { chatRoute } = await import("./chat.js");
    await bus.publish("prospect-marks", "prospect:mark", { secret: "old-replica" });
    await bus.publish("prospect-marks", "prospect:batch", { secret: "old-batch" });
    await bus.publish("synthetic-chat", "text_delta", { text: "chat remains" });
    const db = { select: () => ({ from: async () => {
      if (state === "unreadable") throw new Error("database unavailable");
      return [{ destinationOpen: state === "open", maintenanceBarrier: true }];
    } }) };
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
