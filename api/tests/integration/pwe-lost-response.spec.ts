import { randomUUID } from "node:crypto";
import { serve } from "@hono/node-server";
import { request as requestHttp, type Server } from "node:http";
import { expect, it, vi } from "vitest";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import * as writer from "../../src/services/facets/scoped-writer.js";
import * as issuer from "../../src/artifacts/write-intent-page-authority.js";
import { bootstrapOf } from "../../src/artifacts/write-intent-app-surface-harness.js";
import { readProjectionScope } from "../../src/services/facets/projection-revisions.js";
import { identityFixture } from "./pwe-identity-fixture.js";
import { effects, ONE_COMMIT } from "./pwe-fixture.js";

describeDb("PWE-08 C08 API TCP response loss", () => {
  it("should recover the initial receipt after a committed response is cut without a second writer or debit", async () => {
    const domain = { identityIssuer: "https://loss-idp.example.test", tier: "preprod" as const,
      appOrigin: "https://loss-app.example.test", clientId: "loss-pwe" };
    const h = await identityFixture(domain, randomUUID());
    const executor = vi.spyOn(writer, "writeScopedPersonalFacetInTx");
    const signatures = vi.spyOn(issuer, "mintPageWriteGrant");
    let dropped = false;
    let cutStatus = 0;
    const server = serve({ hostname: "127.0.0.1", port: 0, fetch: async (request, bindings) => {
      const response = await h.app.fetch(request, bindings);
      if (!dropped && request.method === "POST" && new URL(request.url).pathname.endsWith("/confirm")) {
        cutStatus = response.status;
        dropped = true; bindings.outgoing.destroy();
      }
      return response;
    } }) as Server;
    try {
      await new Promise<void>((resolve) => server.once("listening", () => resolve()));
      const address = server.address();
      expect(address).not.toBeNull(); expect(typeof address).toBe("object");
      const base = `http://127.0.0.1:${(address as { port: number }).port}`;
      const send = (url: string, options: { method?: string; headers: Record<string, string>; body?: string }) =>
        new Promise<{ status: number; body: string }>((resolve, reject) => {
          const request = requestHttp(url, { method: options.method ?? "GET", headers: options.headers }, (response) => {
            const chunks: Buffer[] = [];
            response.on("data", (chunk: Buffer) => chunks.push(chunk));
            response.on("error", reject);
            response.on("end", () => resolve({ status: response.statusCode!, body: Buffer.concat(chunks).toString() }));
          });
          request.on("error", reject); request.end(options.body);
        });
      const boot = bootstrapOf(await (await h.summary()).text());
      expect(executor).not.toHaveBeenCalled();
      const options = { method: "POST", headers: { host: new URL(domain.appOrigin).host,
        cookie: h.login.cookie, origin: domain.appOrigin, "content-type": "application/json",
        "x-artifact-write-csrf": boot.csrf as string }, body: JSON.stringify({ challengeToken: boot.challengeToken }) };
      const url = `${base}/api/v1/artifacts/write-intents/${h.row.intentId}/confirm`;
      await expect(send(url, options)).rejects.toThrow();
      expect(dropped).toBe(true);
      expect(cutStatus).toBe(200);
      expect(await effects(h.h.f)).toEqual(ONE_COMMIT);
      const current = await readProjectionScope(h.h.f.db, h.login.session.sub,
        h.h.f.workspaceId, h.row.citySlug, "signal");
      expect(current.token).not.toBe(h.row.expectedProjectionToken);
      const status = await send(`${base}/api/v1/artifacts/reader/facets/write-intents/${h.row.intentId}`,
        { headers: { host: new URL(domain.appOrigin).host, "x-synthetic-page-proof": h.h.page.grant.sessionId } });
      expect(status.status).toBe(200);
      expect(JSON.parse(status.body)).toMatchObject({ data: { state: "committed", commandId: h.row.commandKey,
        receipt: { event: { state: "active", basket: "pertinent" } } } });
      const replay = await send(url, options);
      expect(replay.status).toBe(409);
      expect(JSON.parse(replay.body)).toMatchObject({ error: { code: "challenge_consumed" } });
      expect(executor).toHaveBeenCalledTimes(1);
      expect(signatures).not.toHaveBeenCalled();
      expect(await effects(h.h.f)).toEqual(ONE_COMMIT);
    } finally {
      executor.mockRestore();
      signatures.mockRestore();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
