/**
 * ÉV16 — Tool-execution path tests.
 *
 * Exercises `executeBacklogTool` against a real ÉV15 backlog route (injected as
 * `fetchImpl`) so the tool→backlog flow is covered without a live server: a
 * chat tool call must add then process a backlog item, and `GET /api/backlog`
 * must reflect both changes.
 */

import { describe, expect, it } from "vitest";

import { backlogRoute, createBacklogStore } from "../../routes/backlog.js";
import {
  AJOUTER_DEMANDE,
  BACKLOG_TOOLS,
  TRAITER_DEMANDE,
  executeBacklogTool,
} from "./backlog-tools.js";

/**
 * A `fetch` implementation that routes loopback calls to a fresh in-memory
 * backlog Hono app, so the tool executor hits the real ÉV15 endpoints.
 */
const routedFetch = (app: ReturnType<typeof backlogRoute>): typeof fetch =>
  (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    return app.request(path, init);
  }) as unknown as typeof fetch;

describe("BACKLOG_TOOLS definitions", () => {
  it("declares ajouter_demande and traiter_demande as function tools", () => {
    const names = BACKLOG_TOOLS.map((tool) => tool.name);
    expect(names).toContain(AJOUTER_DEMANDE);
    expect(names).toContain(TRAITER_DEMANDE);
    for (const tool of BACKLOG_TOOLS) {
      expect(tool.type).toBe("function");
      expect(tool.inputSchema).toBeTypeOf("object");
    }
  });
});

describe("executeBacklogTool", () => {
  it("ajouter_demande adds an item that GET /api/backlog then returns", async () => {
    const app = backlogRoute(createBacklogStore());
    const fetchImpl = routedFetch(app);

    const result = await executeBacklogTool({
      name: AJOUTER_DEMANDE,
      argumentsText: JSON.stringify({
        titre: "Test ÉV16",
        description: "Demande ajoutee par le chat",
      }),
      fetchImpl,
    });

    expect(result.status).toBe("completed");
    expect(result.item?.titre).toBe("Test ÉV16");
    expect(result.item?.statut).toBe("a-faire");

    const list = (await (await app.request("/api/backlog")).json()) as {
      items: Array<{ id: string; titre: string }>;
    };
    expect(list.items.some((i) => i.titre === "Test ÉV16")).toBe(true);
  });

  it("traiter_demande moves an added item to en-cours", async () => {
    const app = backlogRoute(createBacklogStore());
    const fetchImpl = routedFetch(app);

    const added = await executeBacklogTool({
      name: AJOUTER_DEMANDE,
      argumentsText: JSON.stringify({ titre: "A traiter" }),
      fetchImpl,
    });
    const id = added.item?.id ?? "";

    const processed = await executeBacklogTool({
      name: TRAITER_DEMANDE,
      argumentsText: JSON.stringify({ id }),
      fetchImpl,
    });

    expect(processed.status).toBe("completed");
    expect(processed.item?.statut).toBe("en-cours");
  });

  it("returns an error result for an unknown id instead of throwing", async () => {
    const app = backlogRoute(createBacklogStore());
    const result = await executeBacklogTool({
      name: TRAITER_DEMANDE,
      argumentsText: JSON.stringify({ id: "does-not-exist" }),
      fetchImpl: routedFetch(app),
    });
    expect(result.status).toBe("error");
    expect(result.error).toContain("404");
  });

  it("returns an error result for malformed JSON arguments", async () => {
    const app = backlogRoute(createBacklogStore());
    const result = await executeBacklogTool({
      name: AJOUTER_DEMANDE,
      argumentsText: "{not json",
      fetchImpl: routedFetch(app),
    });
    expect(result.status).toBe("error");
  });

  it("returns an error result for an unknown tool name", async () => {
    const app = backlogRoute(createBacklogStore());
    const result = await executeBacklogTool({
      name: "outil_inconnu",
      argumentsText: "{}",
      fetchImpl: routedFetch(app),
    });
    expect(result.status).toBe("error");
  });
});
