/**
 * ÉV16 — Tool-execution loop test.
 *
 * Mocks the mesh stream so `streamChatTurns` can be exercised without hitting a
 * provider: round 1 yields a `tool_call_start` + a `done(tool_calls)`; the loop
 * must execute the tool, emit a `tool_call_result`, then stream round 2 (plain
 * content + `done`). Asserts the executor is called with the streamed args and
 * the event ordering the UI relies on.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import * as runtime from "./mesh-runtime.js";
import type { ChatTurn } from "./mesh-runtime.js";

type StreamEvent = { type: string; data: Record<string, unknown> };

const asyncIterable = (events: StreamEvent[]): AsyncIterable<StreamEvent> => ({
  async *[Symbol.asyncIterator]() {
    for (const event of events) yield event;
  },
});

describe("streamChatTurns tool loop", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("executes a tool call then continues to a final content turn", async () => {
    const round1: StreamEvent[] = [
      {
        type: "tool_call_start",
        data: {
          toolCallId: "call_1",
          name: "ajouter_demande",
          argumentsText: '{"titre":"Test ÉV16"}',
        },
      },
      { type: "done", data: { finishReason: "tool_calls" } },
    ];
    const round2: StreamEvent[] = [
      { type: "content_delta", data: { delta: "Demande ajoutee." } },
      { type: "done", data: { finishReason: "stop" } },
    ];

    const streamSpy = vi
      .spyOn(runtime.radarLlmMesh, "stream")
      .mockResolvedValueOnce(asyncIterable(round1) as never)
      .mockResolvedValueOnce(asyncIterable(round2) as never);

    const executeTool = vi.fn().mockResolvedValue({
      content: "Demande ajoutee : id test",
      result: { status: "completed", tool: "ajouter_demande" },
    });

    const collected: StreamEvent[] = [];
    for await (const event of runtime.streamChatTurns({
      providerId: "openai",
      model: "gpt-4.1-nano",
      apiKey: "sk-test",
      messages: [{ role: "user", content: "ajoute une demande" }] as ChatTurn[],
      tools: runtime.BACKLOG_TOOLS,
      executeTool,
    })) {
      collected.push(event as StreamEvent);
    }

    // The tool was executed with the streamed arguments.
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(executeTool.mock.calls[0][0]).toMatchObject({
      name: "ajouter_demande",
      argumentsText: '{"titre":"Test ÉV16"}',
    });

    // Two rounds were streamed.
    expect(streamSpy).toHaveBeenCalledTimes(2);

    // Event ordering: tool_call_start -> tool_call_result -> content -> done.
    const types = collected.map((e) => e.type);
    expect(types).toContain("tool_call_start");
    expect(types).toContain("tool_call_result");
    expect(types).toContain("content_delta");
    expect(types[types.length - 1]).toBe("done");
    expect(types.indexOf("tool_call_result")).toBeGreaterThan(
      types.indexOf("tool_call_start"),
    );
    // The intermediate done(tool_calls) is NOT forwarded; only one terminal done.
    expect(types.filter((t) => t === "done")).toHaveLength(1);
  });

  it("streams plain content with no tool calls", async () => {
    vi.spyOn(runtime.radarLlmMesh, "stream").mockResolvedValueOnce(
      asyncIterable([
        { type: "content_delta", data: { delta: "Bonjour." } },
        { type: "done", data: { finishReason: "stop" } },
      ]) as never,
    );
    const executeTool = vi.fn();
    const collected: StreamEvent[] = [];
    for await (const event of runtime.streamChatTurns({
      providerId: "openai",
      model: "gpt-4.1-nano",
      apiKey: "sk-test",
      messages: [{ role: "user", content: "bonjour" }] as ChatTurn[],
      tools: runtime.BACKLOG_TOOLS,
      executeTool,
    })) {
      collected.push(event as StreamEvent);
    }
    expect(executeTool).not.toHaveBeenCalled();
    expect(collected.map((e) => e.type)).toEqual(["content_delta", "done"]);
  });
});
