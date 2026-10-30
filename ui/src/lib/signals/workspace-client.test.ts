/**
 * 6H workspace context: 0 → missing, 1 → selected, N → explicit pick;
 * malformed payloads are refused; every load is a fresh viewer incarnation.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import {
  createWorkspaceContextStore,
  fetchWorkspaces,
  parseWorkspacesResponse,
  resolveWorkspaceSelection,
  WorkspaceClientError,
  workspaceUnavailableMessage,
  type WorkspaceOption,
} from "./workspace-client.js";
import { isLiveScopedContext } from "./signal-facet-scope.js";

const WS_A = "11111111-1111-4111-8111-111111111111";
const WS_B = "22222222-2222-4222-8222-222222222222";

function row(id: string, slug = "equipe", label = "Équipe") {
  return { workspace: { id, slug, label, scope: "all-municipalities" },
    accountId: "33333333-3333-4333-8333-333333333333",
    moderateArchive: false, manageMembers: false };
}

function option(id: string): WorkspaceOption {
  return { id, slug: "s", label: "L", moderateArchive: false, manageMembers: false };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseWorkspacesResponse", () => {
  it("reads the server WorkspaceAccess rows", () => {
    expect(parseWorkspacesResponse({ ok: true, workspaces: [row(WS_A)] })).toEqual([
      { id: WS_A, slug: "equipe", label: "Équipe", moderateArchive: false, manageMembers: false },
    ]);
  });

  it("accepts an empty membership list", () => {
    expect(parseWorkspacesResponse({ ok: true, workspaces: [] })).toEqual([]);
  });

  it.each([
    null,
    {},
    { ok: false, workspaces: [] },
    { ok: true, workspaces: {} },
    { ok: true, workspaces: [{ id: WS_A }] },
    { ok: true, workspaces: [row("not-a-uuid")] },
    { ok: true, workspaces: [{ ...row(WS_A), moderateArchive: "yes" }] },
    { ok: true, workspaces: [row(WS_A), row(WS_A)] },
    { ok: true, workspaces: [row(WS_A, "", "x")] },
  ])("refuses a malformed payload %#", (payload) => {
    expect(() => parseWorkspacesResponse(payload)).toThrowError(WorkspaceClientError);
  });
});

describe("resolveWorkspaceSelection", () => {
  it("zero workspaces is missing, never a default", () => {
    expect(resolveWorkspaceSelection([])).toEqual({ status: "missing" });
  });

  it("exactly one workspace selects it", () => {
    expect(resolveWorkspaceSelection([option(WS_A)])).toEqual({ status: "ready", workspaceId: WS_A });
  });

  it("several workspaces require an explicit pick", () => {
    expect(resolveWorkspaceSelection([option(WS_A), option(WS_B)])).toEqual({ status: "choose" });
    expect(resolveWorkspaceSelection([option(WS_A), option(WS_B)], WS_B))
      .toEqual({ status: "ready", workspaceId: WS_B });
    expect(resolveWorkspaceSelection([option(WS_A), option(WS_B)],
      "44444444-4444-4444-8444-444444444444")).toEqual({ status: "choose" });
  });
});

describe("fetchWorkspaces", () => {
  it("calls GET /api/v1/workspaces with no query string", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, workspaces: [row(WS_A)] }),
      { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchWorkspaces();
    expect(result.map((w) => w.id)).toEqual([WS_A]);
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/v1/workspaces");
  });

  it("keeps the server error code on refusal", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "account_not_approved" }),
      { status: 403, headers: { "content-type": "application/json" } })));
    await expect(fetchWorkspaces()).rejects.toMatchObject({ status: 403, code: "account_not_approved" });
  });
});

describe("createWorkspaceContextStore", () => {
  it("0 memberships: missing, no workspace", async () => {
    const store = createWorkspaceContextStore(async () => []);
    await store.load("sub-a");
    const state = get(store);
    expect(state.status).toBe("missing");
    expect(state.context.workspaceId).toBeNull();
    expect(workspaceUnavailableMessage(state)).toMatch(/Aucun espace de travail/);
  });

  it("1 membership: ready with that workspace", async () => {
    const store = createWorkspaceContextStore(async () => [option(WS_A)]);
    await store.load("sub-a");
    expect(get(store).status).toBe("ready");
    expect(get(store).context.workspaceId).toBe(WS_A);
    expect(workspaceUnavailableMessage(get(store))).toBeNull();
  });

  it("N memberships: choose, then an explicit pick invalidates in-flight reads", async () => {
    const store = createWorkspaceContextStore(async () => [option(WS_A), option(WS_B)]);
    await store.load("sub-a");
    expect(get(store).status).toBe("choose");
    store.select(WS_A);
    const launched = get(store).context;
    expect(launched.workspaceId).toBe(WS_A);
    store.select(WS_B);
    const live = get(store).context;
    expect(live.viewerKey).toBe(launched.viewerKey);
    expect(isLiveScopedContext(launched, live)).toBe(false);
  });

  it("refuses a pick outside the listed workspaces", async () => {
    const store = createWorkspaceContextStore(async () => [option(WS_A), option(WS_B)]);
    await store.load("sub-a");
    store.select("44444444-4444-4444-8444-444444444444");
    expect(get(store).status).toBe("choose");
    expect(get(store).context.workspaceId).toBeNull();
  });

  it("every load mints a fresh viewer incarnation", async () => {
    const store = createWorkspaceContextStore(async () => [option(WS_A)]);
    await store.load("sub-a");
    const first = get(store).context;
    await store.load("sub-a");
    expect(isLiveScopedContext(first, get(store).context)).toBe(false);
  });

  it("a failed or malformed read leaves the context unusable", async () => {
    const store = createWorkspaceContextStore(async () => {
      throw new WorkspaceClientError("invalid_workspaces_response");
    });
    await store.load("sub-a");
    expect(get(store).status).toBe("error");
    expect(get(store).context.workspaceId).toBeNull();
  });

  it("a superseded load never overwrites the newer state", async () => {
    let release: (value: WorkspaceOption[]) => void = () => {};
    const calls: Array<Promise<WorkspaceOption[]>> = [
      new Promise((resolve) => { release = resolve; }),
      Promise.resolve([option(WS_B)]),
    ];
    const store = createWorkspaceContextStore(() => calls.shift()!);
    const first = store.load("sub-a");
    await store.load("sub-b");
    release([option(WS_A)]);
    await first;
    expect(get(store).sub).toBe("sub-b");
    expect(get(store).context.workspaceId).toBe(WS_B);
  });

  it("reset forgets the context", async () => {
    const store = createWorkspaceContextStore(async () => [option(WS_A)]);
    await store.load("sub-a");
    store.reset();
    expect(get(store).status).toBe("idle");
    expect(get(store).context.viewerKey).toBeNull();
  });
});
