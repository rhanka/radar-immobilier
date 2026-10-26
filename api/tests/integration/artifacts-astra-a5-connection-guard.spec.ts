import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Socket } from "node:net";
import pg from "pg";
import { guardArtifactPool, withArtifactAdvisoryLock } from "@radar/artifacts-host";
import { openConnectionPeer } from "./artifacts-astra-a5-connection-worker.helpers.js";
import { ALICE, startAstra, type Astra } from "./artifacts-astra-a5.helpers.js";

describe("astra A5 real connection break in an isolated process", () => {
  let h: Astra;
  beforeAll(async () => { h = await startAstra("break"); await h.openHost(); });
  afterAll(async () => { await h?.close(); });

  it("survives reserved-client error events and discards the dead client", async () => {
    const peer = await openConnectionPeer(h);
    try {
      expect(peer.pid).not.toBe(process.pid);
      const { pid } = await peer.call("reserve") as { pid: number };
      await h.pool.query("SELECT pg_terminate_backend($1)", [pid]);
      await expect.poll(async () => await peer.call("status")).toEqual({ queryable: false });
      expect(await peer.call("release")).toEqual({ pid: peer.pid });
      expect(await peer.call("ensure")).toMatchObject({ ok: true });
    } finally { await peer.close(); }
  });

  it("normalizes an actual connection-open timeout", async () => {
    const sockets = new Set<Socket>();
    const server = createServer((socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const pool = guardArtifactPool(new pg.Pool({ host: "127.0.0.1",
      port: (server.address() as { port: number }).port, connectionTimeoutMillis: 100 }));
    try {
      await expect(withArtifactAdvisoryLock(pool, "aaaaaaaaaaaaaaaa", async () => undefined))
        .rejects.toMatchObject({ code: "artifact_pool_timeout",
          cause: { message: "Connection terminated due to connection timeout" } });
    } finally {
      await pool.end(); for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("returns a retryable typed outcome after a real coordinator connection break", async () => {
    const peer = await openConnectionPeer(h);
    const holder = await h.pool.connect();
    let pending: Promise<unknown> | undefined;
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT id FROM account_users WHERE sub=$1 FOR UPDATE", [ALICE]);
      const before = await h.durable();
      pending = peer.call("ensure", { key: "broken-finalize" });
      void pending.catch(() => {});
      let pid = 0;
      await expect.poll(async () => {
        const row = (await h.pool.query(`SELECT pid FROM pg_stat_activity
          WHERE datname=current_database() AND wait_event_type='Lock'
          AND query LIKE '%account_users%FOR SHARE%'`)).rows[0];
        pid = Number(row?.pid ?? 0); return pid > 0;
      }, { timeout: 750 }).toBe(true);
      await h.pool.query("SELECT pg_terminate_backend($1)", [pid]);
      expect(await pending).toMatchObject({ ok: false,
        failure: { category: "provider_unavailable", httpStatus: 503, retriable: true } });
      await holder.query("ROLLBACK");
      expect(await h.durable()).toEqual(before);
      expect(await peer.call("ensure", { key: "broken-finalize" })).toMatchObject({ ok: true });
    } finally {
      await holder.query("ROLLBACK"); holder.release();
      await pending?.catch(() => {}); await peer.close();
    }
  });
});
