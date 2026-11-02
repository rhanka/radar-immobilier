import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { STARTER_READER_JS } from "./starter-files.js";

const openContext = { ok: true, context: { signals: { availability: { state: "open" } } } };
function client(respond: (path: string, init: RequestInit) => Response, withGrant = true) {
  let now = 1000;
  const fetch = vi.fn(async (path: string, init: RequestInit) => respond(path, init));
  const history = { replaceState: vi.fn() };
  const window = {} as { ImmoReader: {
    context(id: string): Promise<unknown>; search(args: object): Promise<unknown>;
    workspaces(): Promise<unknown>;
    ensureGrant(): Promise<void>;
  } };
  runInNewContext(STARTER_READER_JS, { window, history, fetch, URL, URLSearchParams, AbortController,
    setTimeout, clearTimeout, Date: { now: () => now },
    location: { href: `https://release.pinned.example.test/index.html?citySlug=city${withGrant ? "&grant=initial" : ""}#results` } });
  return { reader: window.ImmoReader, fetch, history, expire: () => { now += 60_000; } };
}

describe("publishable H5 client", () => {
  it("should strip only the grant and send explicit workspace and search parameters", async () => {
    const c = client((path) => Response.json(path.includes("context") ? openContext : { ok: true, items: [] }));
    expect(c.history.replaceState).toHaveBeenCalledWith(null, "", "/index.html?citySlug=city#results");
    await c.reader.context("workspace");
    await c.reader.search({ workspaceId: "workspace", citySlug: "city", basket: "all", limit: 20, cursor: "opaque" });
    expect(c.fetch.mock.calls.map(([path]) => path)).toEqual([
      "/__reader/api/baskets.context.v1?workspaceId=workspace",
      "/__reader/api/baskets.search.v1?workspaceId=workspace&citySlug=city&basket=all&limit=20&cursor=opaque",
    ]);
    for (const [, init] of c.fetch.mock.calls) {
      expect(init.credentials).toBe("same-origin");
      expect(init.headers).toEqual({ "x-preview-grant": "initial" });
    }
  });

  it("should discover workspaces using the reader grant without workspace or identity parameters", async () => {
    const body = { ok: true, workspaces: [{ id: "workspace", label: "Team", slug: "team",
      signals: { availability: { state: "open" } } }] };
    const c = client(() => Response.json(body));
    expect(await c.reader.workspaces()).toEqual(body);
    expect(c.fetch).toHaveBeenCalledWith("/__reader/api/workspaces.list.v1", expect.objectContaining({
      method: "GET", credentials: "same-origin", headers: { "x-preview-grant": "initial" },
    }));
  });

  it("should preserve discovery refusal instead of returning an empty workspace list", async () => {
    const c = client(() => Response.json({ ok: false, requestId: "trace", error: { code: "account_not_approved" } }, { status: 403 }));
    await expect(c.reader.workspaces()).rejects.toMatchObject({ kind: "denied", code: "account_not_approved", requestId: "trace" });
  });

  it("should share concurrent renewal and recover once without an expired grant", async () => {
    const c = client((path, init) => {
      if (path === "/__reader/renew") return (init.headers as Record<string, string>)["x-preview-grant"]
        ? Response.json({ error: "unauthenticated" }, { status: 401 }) : Response.json({ grant: "renewed" });
      return Response.json(path.includes("context") ? openContext : { ok: true, items: [] });
    });
    c.expire();
    await Promise.all([c.reader.workspaces(), c.reader.context("workspace"), c.reader.search({ workspaceId: "workspace", citySlug: "city" })]);
    const renewals = c.fetch.mock.calls.filter(([path]) => path === "/__reader/renew");
    expect(renewals).toHaveLength(2);
    expect(renewals[0]![1].headers).toEqual({ "x-preview-grant": "initial" });
    expect(renewals[1]![1].headers).toEqual({});
    for (const [, init] of c.fetch.mock.calls.slice(2)) expect(init.headers).toEqual({ "x-preview-grant": "renewed" });
  });

  it("should stop after denied renewal and never turn failure into an empty search", async () => {
    const c = client(() => Response.json({ error: "unauthenticated" }, { status: 401 }));
    c.expire();
    await expect(c.reader.context("workspace")).rejects.toMatchObject({ kind: "session", code: "unauthenticated" });
    expect(c.fetch).toHaveBeenCalledTimes(2);
    expect(c.fetch.mock.calls.every(([path]) => path === "/__reader/renew")).toBe(true);
  });

  it("should recover a sealed session when opened without a URL grant", async () => {
    const c = client((path) => Response.json(path === "/__reader/renew" ? { grant: "renewed" } : openContext), false);
    await c.reader.context("workspace");
    expect(c.fetch.mock.calls[0]![1].headers).toEqual({});
    expect(c.fetch).toHaveBeenCalledTimes(2);
  });

  it("should distinguish closed capabilities and expired continuation from empty results", async () => {
    const closed = client(() => Response.json({ ok: true, context: { signals: {
      availability: { state: "closed", reason: "maintenance" } } } }));
    await expect(closed.reader.context("workspace")).rejects.toMatchObject({ kind: "unavailable", code: "maintenance" });
    const changed = client(() => Response.json({ ok: false, requestId: "trace", error: { code: "cursor_expired" } }, { status: 409 }));
    await expect(changed.reader.search({})).rejects.toMatchObject({ kind: "changed", code: "cursor_expired", requestId: "trace" });
    expect(changed.fetch).toHaveBeenCalledTimes(1);
  });
});
