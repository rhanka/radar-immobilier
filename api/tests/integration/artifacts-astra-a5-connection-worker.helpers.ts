import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { composeArtifactHost } from "@radar/artifacts-host";
import { ALICE, live, type Astra } from "./artifacts-astra-a5.helpers.js";

export async function openConnectionPeer(h: Astra) {
  const child = fork(fileURLToPath(import.meta.url), ["--connection-peer"], {
    execArgv: ["--import", "tsx"], stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  let sequence = 0;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  child.on("message", (raw) => {
    const message = raw as { id: number; value?: unknown; error?: string };
    const call = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) call?.reject(new Error(message.error)); else call?.resolve(message.value);
  });
  child.on("exit", (code) => {
    for (const call of pending.values()) call.reject(new Error(`connection peer exited: ${code}`));
    pending.clear();
  });
  const call = (method: string, args: unknown = {}): Promise<unknown> => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("connection peer deadline")); }, 5000);
    pending.set(id, { resolve(value) { clearTimeout(timer); resolve(value); },
      reject(error) { clearTimeout(timer); reject(error); } });
    child.send({ id, method, args });
  });
  try { await call("init", { params: h.params, config: h.config }); }
  catch (error) { child.kill(); throw error; }
  return { pid: child.pid, call, async close() {
    if (child.exitCode !== null) return;
    try { await call("close"); } finally { child.disconnect(); child.kill(); }
  } };
}

if (process.argv[2] === "--connection-peer") {
  let pool: pg.Pool;
  let host: Awaited<ReturnType<typeof composeArtifactHost>>;
  let scope: string;
  let reserved: pg.PoolClient | undefined;
  process.on("message", async (raw) => {
    const message = raw as { id: number; method: string; args: {
      params: pg.PoolConfig; config: Astra["config"]; key?: string } };
    try {
      let value: unknown;
      if (message.method === "init") {
        pool = new pg.Pool(message.args.params);
        scope = message.args.config.storageScope;
        host = await composeArtifactHost(pool, message.args.config, undefined,
          { readActivation: live, contentBase: "pages.example.test" });
      } else if (message.method === "reserve") {
        reserved = await pool.connect();
        value = (await reserved.query("SELECT pg_backend_pid() AS pid")).rows[0];
      } else if (message.method === "release") {
        reserved!.release(); reserved = undefined;
        value = { pid: process.pid };
      } else if (message.method === "status") {
        value = { queryable: (reserved as unknown as { _queryable: boolean })._queryable };
      } else if (message.method === "ensure") {
        value = await host.execute({ method: "POST", path: "/ensure", actorId: ALICE,
          body: { bindingName: message.args.key ?? "connection", idempotencyKey: message.args.key ?? "connection" } }, {
          invocationId: crypto.randomUUID(), actorId: ALICE, storageScopeId: scope,
          authorizeCommit: host.authorizeCommit,
        });
      } else if (message.method === "close") { reserved?.release(); host.close(); await pool.end(); }
      process.send?.({ id: message.id, value });
    } catch (error) {
      process.send?.({ id: message.id, error: error instanceof Error ? error.message : String(error) });
    }
  });
}
