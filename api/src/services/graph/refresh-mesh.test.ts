import type { GraphifyMesh } from "@sentropic/graphify/llm-mesh";
import { InMemoryKeyring } from "@sentropic/llm-mesh-refresh/node";
import { describe, expect, it } from "vitest";

import { bindRefreshAbortSignal, createRefreshMesh } from "./refresh-mesh.js";

const response = {
  id: "response-1",
  providerId: "gemini" as const,
  modelId: "gemini-3.8-flash",
  message: { role: "assistant" as const, content: "{}" },
  text: "{}",
  toolCalls: [],
  finishReason: "stop" as const,
};

describe("refresh mesh", () => {
  it("should reject a missing owner scope before constructing the planner", () => {
    expect(() => createRefreshMesh({
      routingSubject: { principalRef: "principal:test", ownerScopeRef: "" },
      configResolver: { async resolveConfig() { return {}; } },
      keyring: new InMemoryKeyring(),
      provider: "gemini",
      model: "gemini-3.8-flash",
      signal: new AbortController().signal,
    })).toThrow("explicit principal and owner scope");
  });

  it("should construct alias adapters without changing the chat mesh", () => {
    const bundle = createRefreshMesh({
      routingSubject: { principalRef: "principal:test", ownerScopeRef: "owner:test" },
      configResolver: { async resolveConfig() { return {}; } },
      keyring: new InMemoryKeyring(),
      provider: "gemini",
      model: "gemini-3.8-flash",
      signal: new AbortController().signal,
    });
    expect(bundle.mesh.listProviders().map((item) => item.providerId)).toContain("gemini");
    expect(bundle.textClient.model).toBe("gemini-3.8-flash");
  });

  it("should propagate the run signal through validated generation", async () => {
    const seen: AbortSignal[] = [];
    const fake: GraphifyMesh = {
      listProviders: () => [],
      listModels: () => [],
      async generate(request) { seen.push(request.signal!); return response; },
      async generateValidated(request, validate) {
        seen.push(request.signal!);
        await validate(response);
        return response;
      },
      async stream() { throw new Error("not used"); },
    };
    const controller = new AbortController();
    const bound = bindRefreshAbortSignal(fake, controller.signal);
    await bound.generate({ messages: [] });
    await bound.generateValidated({ messages: [] }, () => undefined);
    expect(seen).toEqual([controller.signal, controller.signal]);
  });
});
