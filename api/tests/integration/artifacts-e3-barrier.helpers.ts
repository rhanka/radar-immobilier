import type pg from "pg";
import { arrived, type CommitBarrier, type CommitBarrierPoint,
  type InvocationContextShape } from "./artifacts-provider-contract.helpers.js";

/** Register the correlated wait inside the transport, before host.execute. */
export function startCorrelatedBarrier<T>(barrier: CommitBarrier, point: CommitBarrierPoint,
  start: (register: (invocation: InvocationContextShape) => void) => Promise<T>) {
  let invocationId: string | undefined;
  let paused = false;
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const reached = new Promise<void>((ok, fail) => { resolve = ok; reject = fail; });
  const pending = start((invocation) => {
    if (invocationId !== undefined) throw new Error("E3 transport dispatched more than once");
    invocationId = invocation.invocationId;
    void arrived(barrier, point, invocationId).then(() => { paused = true; resolve(); }, reject);
  });
  void pending.catch(reject);
  void pending.then(() => reject(new Error("E3 operation settled before barrier")), () => {});
  return { pending, reached, release() {
    if (paused && invocationId) { paused = false; barrier.release(point, invocationId); }
  } };
}

/** Observe real transactions; no query is replaced and no error is fabricated. */
export function createBarrierFaultProbe(pool: pg.Pool) {
  const evidence = { begins: 0, writes: 0, commits: 0, rollbacks: 0, errors: [] as string[] };
  let active: pg.PoolClient | undefined;
  const instrumented = new Proxy(pool, { get(target, property, receiver) {
    if (property === "connect") return async () => {
      const client = await target.connect();
      let inTransaction = false;
      return new Proxy(client, { get(leased, key, clientReceiver) {
        if (key === "query") return async (text: string, params?: unknown[]) => {
          try {
            const result = await leased.query(text, params);
            if (/^\s*BEGIN\b/i.test(text)) {
              active = leased; inTransaction = true; evidence.begins++;
            }
            if (inTransaction && /^\s*(INSERT|UPDATE|DELETE)\b/i.test(text)) evidence.writes++;
            if (/^\s*COMMIT\b/i.test(text)) { evidence.commits++; inTransaction = false; }
            if (/^\s*ROLLBACK\b/i.test(text)) { evidence.rollbacks++; inTransaction = false; }
            return result;
          } catch (error) {
            evidence.errors.push(String((error as { code?: string }).code));
            throw error;
          }
        };
        const value = Reflect.get(leased, key, clientReceiver);
        return typeof value === "function" ? value.bind(leased) : value;
      } });
    };
    const value = Reflect.get(target, property, receiver);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  return { pool: instrumented, evidence,
    async setTimeout(kind: "lock" | "statement") {
      if (!active) throw new Error("E3 barrier reached without an active transaction");
      await active.query("SET LOCAL lock_timeout = '0'");
      await active.query("SET LOCAL statement_timeout = '0'");
      await active.query(kind === "lock"
        ? "SET LOCAL lock_timeout = '150ms'" : "SET LOCAL statement_timeout = '150ms'");
    },
  };
}
