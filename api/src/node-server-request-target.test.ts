import { createServer, request as httpRequest } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * GHSA-jpvv-r467-5p4w: before @hono/node-server 2.1.6 (1.19.18 on 1.x), a
 * backslash in the request path was normalised to `/` while building the
 * request URL. A reverse proxy allowing `/public/*` would forward
 * `/public/..\admin`, and the Node listener would then dispatch it to
 * `/admin`. The api, content-deny and content-reader listeners all go
 * through `getRequestListener`, so this locks the fixed behaviour of the
 * resolved dependency: such a request is rejected with 400 and no route
 * runs, while a backslash in the query string is still accepted.
 */
describe("@hono/node-server request target handling", () => {
  const hits: string[] = [];
  let server: Server;
  let port: number;

  beforeAll(async () => {
    const app = new Hono();
    app.get("/admin", (c) => {
      hits.push("admin");
      return c.text("admin");
    });
    app.get("/public/*", (c) => {
      hits.push("public");
      return c.json({ path: c.req.path, q: c.req.query("q") ?? null });
    });
    const listener = getRequestListener(app.fetch);
    server = createServer((req, res) => listener(req, res));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  /** Raw GET: the path is sent verbatim (the WHATWG URL parser is bypassed). */
  function get(path: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const req = httpRequest({ host: "127.0.0.1", port, method: "GET", path }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      });
      req.on("error", reject);
      req.end();
    });
  }

  it("rejects a backslash in the path instead of routing it to another handler", async () => {
    hits.length = 0;
    for (const path of ["/public/..\\admin", "/public\\..\\admin", "/\\admin"]) {
      const res = await get(path);
      expect(res.status, path).toBe(400);
      expect(res.body, path).not.toBe("admin");
    }
    expect(hits).toEqual([]);
  });

  it("still serves ordinary paths and a backslash inside the query string", async () => {
    hits.length = 0;
    expect((await get("/admin")).status).toBe(200);
    const res = await get("/public/file?q=a\\b");
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ path: "/public/file", q: "a\\b" });
    expect(hits).toEqual(["admin", "public"]);
  });
});
