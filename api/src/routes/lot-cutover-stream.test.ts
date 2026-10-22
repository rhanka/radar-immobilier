import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => { vi.resetModules(); });

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

  it("should deliver every mark and batch on the open connection when the fence read fails", async () => {
    const bus = await import("../services/chat/stream-bus.js");
    const { chatRoute } = await import("./chat.js");
    await bus.publish("prospect-marks", "prospect:mark", { text: "mark before outage" });
    await bus.publish("prospect-marks", "prospect:batch", { text: "batch before outage" });
    await bus.publish("synthetic-chat", "text_delta", { text: "chat before outage" });
    let rejectRead!: (reason: unknown) => void;
    const pending = new Promise<never>((_, reject) => { rejectRead = reject; });
    void pending.catch(() => {});
    let recovered = false;
    const select = vi.fn(() => {
      if (select.mock.calls.length === 1) throw new Error("database unavailable");
      return { from: async () => recovered ? [{ enabled: false }] : pending };
    });
    const route = chatRoute({ select } as never);
    const response = await route.request("/api/chat/streams/sse");
    const reader = response.body!.getReader();
    let delayed: Response | undefined;
    try {
      const replayed = await readThrough(reader, "chat before outage");
      const opening = route.request("/api/chat/streams/sse");
      await bus.publish("prospect-marks", "prospect:mark", { text: "mark during outage" });
      await bus.publish("prospect-marks", "prospect:batch", { text: "batch during outage" });
      recovered = true;
      rejectRead(new Error("late database failure"));
      delayed = await opening;
      await bus.publish("synthetic-chat", "text_delta", { text: "late read checked" });
      const during = await readThrough(reader, "late read checked");
      await bus.publish("prospect-marks", "prospect:mark", { text: "mark after outage" });
      await bus.publish("prospect-marks", "prospect:batch", { text: "batch after outage" });
      await bus.publish("synthetic-chat", "text_delta", { text: "after checked" });
      const live = await readThrough(reader, "after checked");
      const all = replayed + during + live;
      for (const marker of ["mark before outage", "batch before outage", "chat before outage",
        "mark during outage", "batch during outage", "mark after outage", "batch after outage"]) {
        expect(all.match(new RegExp(marker, "g")), marker).toHaveLength(1);
      }
      expect(all.indexOf("mark before outage")).toBeLessThan(all.indexOf("mark during outage"));
      expect(all.indexOf("mark during outage")).toBeLessThan(all.indexOf("mark after outage"));
      expect(select).toHaveBeenCalledTimes(2); // Only the two opening reads.
      expect(bus.isLegacyMarkDeliveryRetired()).toBe(false);
    } finally { await reader.cancel(); await delayed?.body?.cancel(); }
  });

  it("should replay and stream marks on a new connection after fence recovery", async () => {
    const bus = await import("../services/chat/stream-bus.js");
    const { chatRoute } = await import("./chat.js");
    const { lotCutoverState } = await import("../db/schema.js");
    const db = { select: () => ({ from: async (table: unknown) =>
      table === lotCutoverState ? [] : [{ enabled: false }] }) };
    await bus.publish("prospect-marks", "prospect:mark", { text: "replayed mark" });
    await bus.publish("prospect-marks", "prospect:batch", { text: "replayed batch" });
    await bus.publish("synthetic-chat", "text_delta", { text: "replay checked" });
    const response = await chatRoute(db as never).request("/api/chat/streams/sse");
    const reader = response.body!.getReader();
    try {
      const replay = await readThrough(reader, "replay checked");
      expect(replay.match(/replayed mark/g)).toHaveLength(1);
      expect(replay.match(/replayed batch/g)).toHaveLength(1);
      await bus.publish("prospect-marks", "prospect:mark", { text: "new live mark" });
      await bus.publish("prospect-marks", "prospect:batch", { text: "new live batch" });
      await bus.publish("synthetic-chat", "text_delta", { text: "new checked" });
      const direct = await readThrough(reader, "new checked");
      expect(direct).toContain("new live mark");
      expect(direct).toContain("new live batch");
      expect(direct).not.toContain("replayed ");
      expect(bus.isLegacyMarkDeliveryRetired()).toBe(false);
    } finally { await reader.cancel(); }
  });

  it("should keep a confirmed cutover closed when a later fence read fails", async () => {
    const bus = await import("../services/chat/stream-bus.js");
    const { chatRoute } = await import("./chat.js");
    await bus.publish("prospect-marks", "prospect:mark", { text: "historic mark" });
    await bus.publish("synthetic-chat", "text_delta", { text: "historic chat" });
    const before = await chatRoute().request("/api/chat/streams/sse");
    const reader = before.body!.getReader();
    // The §6K retirement closes readers and destroys replay buffers.
    bus.retireLegacyMarkDelivery();
    await expect(reader.read()).rejects.toThrow("legacy_mark_delivery_retired");
    await bus.publish("prospect-marks", "prospect:mark", { text: "late mark" });
    await bus.publish("prospect-marks", "prospect:batch", { text: "late batch" });
    await bus.publish("synthetic-chat", "text_delta", { text: "chat stays" });
    await expect(reader.read()).rejects.toThrow("legacy_mark_delivery_retired");
    const failingDb = { select: () => { throw new Error("database unavailable"); } };
    const reopened = await chatRoute(failingDb as never).request("/api/chat/streams/sse");
    const next = reopened.body!.getReader();
    try {
      await bus.publish("prospect-marks", "prospect:mark", { text: "reopened mark" });
      await bus.publish("prospect-marks", "prospect:batch", { text: "reopened batch" });
      await bus.publish("synthetic-chat", "text_delta", { text: "reopen checked" });
      const text = await readThrough(next, "reopen checked");
      expect(text).toContain("chat stays");
      expect(text).not.toContain("prospect:mark");
      expect(text).not.toContain("prospect:batch");
      expect(text).not.toContain("historic mark");
      expect(text).not.toContain("late mark");
      expect(bus.isLegacyMarkDeliveryRetired()).toBe(true);
    } finally { await next.cancel(); }
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
