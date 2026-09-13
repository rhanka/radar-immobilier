import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";

import {
  createGraphifyMesh,
  meshTextJsonClient,
  type GraphifyMesh,
} from "@sentropic/graphify/llm-mesh";
import {
  DEFAULT_ROUTE_POLICY,
  type GenerateRequest,
  type GenerateResponse,
  type RouteFailureClassification,
  type RoutePlanner,
  type VerifiedRoutingSubject,
} from "@sentropic/llm-mesh-refresh";
import { InMemoryKeyring } from "@sentropic/llm-mesh-refresh/node";
import { describe, expect, it, vi } from "vitest";

import {
  bindRefreshAbortSignal, bindRefreshFetchSignal, createRefreshMesh, refreshErrorDiagnostic,
} from "./refresh-mesh.js";

const response = {
  id: "response-1",
  providerId: "gemini" as const,
  modelId: "gemini-3.8-flash",
  message: { role: "assistant" as const, content: "{}" },
  text: "{}",
  toolCalls: [],
  finishReason: "stop" as const,
};

const subject: VerifiedRoutingSubject = {
  principalRef: "principal:test",
  ownerScopeRef: "owner:test",
};

function meshVersions(): string[] {
  const hostRequire = createRequire(import.meta.url);
  const graphifyDist = dirname(hostRequire.resolve("@sentropic/graphify"));
  const versionFrom = (relativePath: string) => JSON.parse(readFileSync(
    resolve(graphifyDist, relativePath), "utf8",
  )).version as string;
  return [
    versionFrom("../../llm-mesh/package.json"),
    versionFrom("../../llm-mesh-refresh/package.json"),
    versionFrom("../node_modules/@sentropic/llm-mesh/package.json"),
  ];
}

function runtimeHarness(generate: (request: GenerateRequest) => Promise<GenerateResponse>) {
  const subjects: VerifiedRoutingSubject[] = [];
  const events: string[] = [];
  const outcomes: RouteFailureClassification[] = [];
  const planner: RoutePlanner = {
    async plan(received, input) {
      subjects.push(received);
      return {
        planRef: "plan:test",
        expiresAt: "2099-01-01T00:00:00.000Z",
        candidateRefs: ["candidate:test"],
        policy: DEFAULT_ROUTE_POLICY,
        councilRevision: "test",
        diagnostics: [{
          candidateRef: "candidate:test",
          diagnosticAccountRef: "account:redacted",
          requestedModel: input.requestedModel,
          actualProviderId: "gemini",
          actualModelId: input.requestedModel,
          actualTransportProviderId: "cloud-code",
          reason: "exact",
          cacheContinuityRisk: false,
        }],
      };
    },
    async prepareAttempt(received) {
      subjects.push(received);
      return {
        attemptRef: "attempt:test",
        async generate(request) { events.push("generate"); return generate(request); },
        async stream() { throw new Error("not used"); },
        async recordOutcome(value) { outcomes.push(value); },
        async markCommitted() {},
        async complete() { events.push("complete"); },
        async releaseCancelled() { events.push("cancelled"); },
      };
    },
    describeAffinity: () => null,
    promoteAffinity() { throw new Error("not used"); },
    rebindAffinity() { throw new Error("not used"); },
    resetAffinity: () => false,
  };
  const mesh = createGraphifyMesh({
    routingSubject: subject,
    createRoutePlanner(runtime) {
      expect(typeof runtime.generate).toBe("function");
      return planner;
    },
  });
  return { mesh, subjects, events, outcomes };
}

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
    const efforts: unknown[] = [];
    const fake: GraphifyMesh = {
      listProviders: () => [],
      listModels: () => [],
      async generate(request) { seen.push(request.signal!); efforts.push(request.reasoning?.effort); return response; },
      async generateValidated(request, validate) {
        seen.push(request.signal!);
        efforts.push(request.reasoning?.effort);
        await validate(response);
        return response;
      },
      async stream() { throw new Error("not used"); },
    };
    const controller = new AbortController();
    const bound = bindRefreshAbortSignal(fake, controller.signal, { effort: "high" });
    await bound.generate({ messages: [] });
    await bound.generateValidated({ messages: [] }, () => undefined);
    expect(seen).toEqual([controller.signal, controller.signal]);
    expect(efforts).toEqual(["high", "high"]);
  });

  it("should abort an active response stream through the bound transport fetch", async () => {
    const server = createServer((_request, reply) => {
      reply.writeHead(200, { "content-type": "text/event-stream" });
      reply.write("data: partial\n\n");
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP test address");
    const run = new AbortController();
    const request = new AbortController();
    try {
      const reply = await bindRefreshFetchSignal(fetch, run.signal)(
        `http://127.0.0.1:${address.port}`, { signal: request.signal },
      );
      const reader = reply.body!.getReader();
      expect(new TextDecoder().decode((await reader.read()).value)).toContain("partial");
      const pending = reader.read();
      run.abort();
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
      expect(request.signal.aborted).toBe(false);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolveClose, reject) => server.close((error) =>
        error ? reject(error) : resolveClose()));
    }
  });

  it("should classify transport metadata without exposing error messages", () => {
    const secret = "Bearer secret-provider-output";
    const error = Object.assign(new TypeError(secret), { statusCode: 502, requestId: "req:test-1",
      cause: Object.assign(new Error(secret), { code: "UND_ERR_SOCKET" }) });
    const diagnostic = refreshErrorDiagnostic(error);
    expect(diagnostic).toMatchObject({ errorName: "TypeError", statusCode: 502,
      requestId: "req:test-1", causeName: "Error", causeCode: "UND_ERR_SOCKET" });
    expect(JSON.stringify(diagnostic)).not.toContain(secret);
  });

  it("should forward schema and token cap through all installed mesh copies", async () => {
    expect(meshVersions()).toEqual(["0.1.2", "0.19.0", "0.19.0"]);
    let captured: GenerateRequest | undefined;
    const harness = runtimeHarness(async (request) => {
      captured = request;
      return response;
    });
    const logged = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const client = meshTextJsonClient(harness.mesh, {
      provider: "gemini",
      model: "gemini-3.8-flash",
    });
    const schema = '{"type":"object","required":["nodes","edges"]}';
    await client.generateJson({
      schema,
      prompt: "Extract one municipal signal.",
      maxOutputTokens: 345,
      validateResponse() { harness.events.push("validate"); },
    });
    expect(captured?.messages[1]?.content).toContain(`Schema: ${schema}\n\n`);
    expect(captured?.maxOutputTokens).toBe(345);
    expect(harness.subjects).toEqual([subject, subject]);
    expect(harness.events).toEqual(["generate", "validate", "complete"]);
    expect(logged).not.toHaveBeenCalled();
    logged.mockRestore();
  });

  it("should classify a routed rate limit and stop a pre-aborted run", async () => {
    const failure = runtimeHarness(async () => {
      throw Object.assign(new Error("quota"), { statusCode: 429 });
    });
    await expect(failure.mesh.generate({
      providerId: "gemini", modelId: "gemini-3.8-flash", messages: [],
    })).rejects.toThrow("quota");
    expect(failure.outcomes).toMatchObject([{ reason: "rate-limited", retryable: true }]);

    const controller = new AbortController();
    controller.abort();
    const aborted = runtimeHarness(async () => response);
    await expect(bindRefreshAbortSignal(aborted.mesh, controller.signal).generate({
      providerId: "gemini", modelId: "gemini-3.8-flash", messages: [],
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(aborted.subjects).toEqual([]);
  });
});
