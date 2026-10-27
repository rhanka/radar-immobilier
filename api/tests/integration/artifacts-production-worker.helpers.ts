import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { composeArtifactHost, createArtifactControl } from "@radar/artifacts-host";
import type { Harness } from "./artifacts-h2.helpers.js";
import { loadConfig } from "../../src/config.js";

export async function openProductionPeer(h: Harness) {
  const child = fork(fileURLToPath(import.meta.url), ["--production-peer"],
    { execArgv: ["--import", "tsx"], stdio: ["ignore", "inherit", "inherit", "ipc"] });
  let sequence = 0;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  child.on("message", (raw) => {
    const message = raw as { id: number; value?: unknown; error?: string };
    const call = pending.get(message.id);
    if (!call) return;
    pending.delete(message.id);
    if (message.error) call.reject(new Error(message.error)); else call.resolve(message.value);
  });
  child.on("exit", () => {
    for (const call of pending.values()) call.reject(new Error("production peer exited"));
    pending.clear();
  });
  const call = (method: string, args: unknown): Promise<unknown> => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("production peer deadline")); }, 5000);
    pending.set(id, { resolve(value) { clearTimeout(timer); resolve(value); },
      reject(error) { clearTimeout(timer); reject(error); } });
    child.send({ id, method, args });
  });
  const env = loadConfig();
  await call("init", { config: h.config, database: { host: env.POSTGRES_HOST, port: env.POSTGRES_PORT,
    user: env.POSTGRES_USER, password: env.POSTGRES_PASSWORD, database: h.pool.options.database } });
  return { pid: child.pid, async ensure(bindingName: string, idempotencyKey: string) {
    return await call("ensure", { bindingName, idempotencyKey }) as { status: number; body: Record<string, unknown> };
  }, async close() {
    try { await call("close", {}); } finally {
      child.disconnect(); child.kill("SIGTERM");
    }
  } };
}

if (process.argv[2] === "--production-peer") {
  let pool: pg.Pool;
  let host: Awaited<ReturnType<typeof composeArtifactHost>>;
  process.on("message", async (raw) => {
    const message = raw as { id: number; method: string; args: Record<string, unknown> };
    try {
      let value: unknown;
      if (message.method === "init") {
        pool = new pg.Pool(message.args.database as pg.PoolConfig);
        host = await composeArtifactHost(pool, message.args.config as Harness["config"]);
        value = { pid: process.pid };
      } else if (message.method === "ensure") {
        value = await createArtifactControl(host, "h2_scope", "pages.example.test")
          .handle("ensure", "alice", message.args);
      } else if (message.method === "close") { host.close(); await pool.end(); }
      process.send?.({ id: message.id, value });
    } catch { process.send?.({ id: message.id, error: "production peer operation failed" }); }
  });
}
