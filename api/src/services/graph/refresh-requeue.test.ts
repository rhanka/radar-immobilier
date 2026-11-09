import { describe, expect, it } from "vitest";

import type { ObjectInfo, ObjectStore } from "../../storage/object-store.js";
import {
  emptyRefreshCoverage, failRefreshDocument, writeRefreshCoverage,
  type RefreshCoverageLedger,
} from "./refresh-coverage.js";
import { runRefreshRequeueAbandoned, runRefreshRequeueRestore } from "./refresh-requeue.js";

class MemoryStore implements ObjectStore {
  readonly objects = new Map<string, Uint8Array>();
  async put(key: string, body: Uint8Array | Buffer | string): Promise<ObjectInfo> {
    this.objects.set(key, typeof body === "string" ? new TextEncoder().encode(body) : new Uint8Array(body));
    return { key };
  }
  async get(key: string): Promise<Uint8Array> {
    const value = this.objects.get(key);
    if (!value) throw new Error(`missing ${key}`);
    return value;
  }
  async head(key: string): Promise<ObjectInfo | null> { return this.objects.has(key) ? { key } : null; }
  async list(prefix: string): Promise<string[]> {
    return [...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort();
  }
}

const sha = (digit: string) => digit.repeat(64);
const clock = (iso: string) => () => new Date(iso);

function ledgerWith(city: string, digit: string, failedAt: string): RefreshCoverageLedger {
  let ledger = emptyRefreshCoverage(city, clock("2026-09-20T00:00:00.000Z"));
  ledger = { ...ledger, documents: { [sha(digit)]: {
    state: "pending", sourceId: "proces-verbaux-city",
    representationKey: `raw/x/cas/${sha(digit)}.pdf`,
    firstSeenAt: "2026-09-20T00:00:00.000Z", updatedAt: "2026-09-20T00:00:00.000Z", failures: 0 } } };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    ledger = failRefreshDocument(ledger, sha(digit), "transport", 3, clock(failedAt)).ledger;
  }
  return ledger;
}

async function seededStore(): Promise<MemoryStore> {
  const store = new MemoryStore();
  await writeRefreshCoverage(store, ledgerWith("alpha", "a", "2026-10-30T00:00:00.000Z"));
  await writeRefreshCoverage(store, ledgerWith("beta", "b", "2026-11-05T00:00:00.000Z"));
  await store.put("refresh/018/gamma/coverage.json", "{ not json");
  return store;
}

describe("runRefreshRequeueAbandoned", () => {
  it("dry-run writes nothing, counts per city, and reports skipped registries", async () => {
    const store = await seededStore();
    const before = new Map(store.objects);
    const trace = await runRefreshRequeueAbandoned(store,
      { who: "op@test", dryRun: true, now: clock("2026-11-09T00:00:00.000Z") });

    expect(store.objects).toEqual(before);
    expect(trace.auditKey).toBeNull();
    expect(trace.totals).toEqual({ cities: 3, requeued: 2, skipped: 1 });
    expect(trace.cities.find((city) => city.citySlug === "gamma")?.skipped).toBe("unreadable");
  });

  it("real run requeues, writes the audit trace next to the registries, and is idempotent", async () => {
    const store = await seededStore();
    const trace = await runRefreshRequeueAbandoned(store,
      { who: "op@test", dryRun: false, cities: ["beta"], now: clock("2026-11-09T00:00:00.000Z") });

    expect(trace.totals.requeued).toBe(1);
    expect(trace.cities[0]?.requeued).toEqual([sha("b")]);
    expect(trace.auditKey).toMatch(/^refresh\/018\/_audit\/requeue-abandoned-/);
    const audit = JSON.parse(new TextDecoder().decode(store.objects.get(trace.auditKey!)));
    expect(audit).toMatchObject({ who: "op@test", dryRun: false });
    expect(audit.cities[0].requeued).toEqual([sha("b")]);

    const again = await runRefreshRequeueAbandoned(store,
      { who: "op@test", dryRun: false, cities: ["beta"], now: clock("2026-11-09T01:00:00.000Z") });
    expect(again.totals.requeued).toBe(0);
  });

  it("copies the original registry to a dated backup before rewriting it", async () => {
    const store = await seededStore();
    const original = store.objects.get("refresh/018/beta/coverage.json")!;
    const order: string[] = [];
    const seenAtRewrite: boolean[] = [];
    const rawPut = store.put.bind(store);
    store.put = async (key: string, body: Uint8Array | Buffer | string) => {
      order.push(key);
      if (key === "refresh/018/beta/coverage.json") {
        seenAtRewrite.push([...store.objects.keys()].some((k) => k.includes("/_backup/") && k.endsWith("/beta/coverage.json")));
      }
      return rawPut(key, body);
    };
    const trace = await runRefreshRequeueAbandoned(store,
      { who: "op@test", dryRun: false, cities: ["beta"], now: clock("2026-11-09T00:00:00.000Z") });
    const city = trace.cities[0]!;
    expect(city.backupKey).toMatch(/^refresh\/018\/_backup\/requeue-abandoned-[^/]+\/beta\/coverage\.json$/);
    expect(store.objects.get(city.backupKey!)).toEqual(original);
    expect(seenAtRewrite).toContain(true);
    expect(order.indexOf(city.backupKey!)).toBeLessThan(order.lastIndexOf("refresh/018/beta/coverage.json"));
    const audit = JSON.parse(new TextDecoder().decode(store.objects.get(trace.auditKey!)));
    expect(audit.cities[0].backupKey).toBe(city.backupKey);
  });

  it("leaves a durable intent trace when the run crashes at city N", async () => {
    const store = await seededStore();
    const rawPut = store.put.bind(store);
    let armed = false;
    store.put = async (key: string, body: Uint8Array | Buffer | string) => {
      if (armed && key === "refresh/018/beta/coverage.json") throw new Error("simulated crash");
      return rawPut(key, body);
    };
    armed = true;
    await expect(runRefreshRequeueAbandoned(store,
      { who: "op@test", dryRun: false, cities: ["alpha", "beta"], now: clock("2026-11-09T00:00:00.000Z") }),
    ).rejects.toThrow("simulated crash");
    const auditKey = [...store.objects.keys()].find((k) => k.startsWith("refresh/018/_audit/requeue-abandoned-"));
    expect(auditKey).toBeTruthy();
    const audit = JSON.parse(new TextDecoder().decode(store.objects.get(auditKey!)));
    expect(audit.cities.find((c: { citySlug: string }) => c.citySlug === "alpha")?.phase).toBe("done");
    const beta = audit.cities.find((c: { citySlug: string }) => c.citySlug === "beta");
    expect(beta?.phase).toBe("intent");
    expect(store.objects.has(beta.backupKey)).toBe(true);
  });

  it("restore recopies the backup byte for byte and is idempotent", async () => {
    const store = await seededStore();
    const original = store.objects.get("refresh/018/beta/coverage.json")!;
    const trace = await runRefreshRequeueAbandoned(store,
      { who: "op@test", dryRun: false, cities: ["beta"], now: clock("2026-11-09T00:00:00.000Z") });
    expect(store.objects.get("refresh/018/beta/coverage.json")).not.toEqual(original);
    const stamp = trace.cities[0]!.backupKey!.split("/")[3]!.replace("requeue-abandoned-", "");
    const first = await runRefreshRequeueRestore(store,
      { who: "op@test", dryRun: false, stamp, cities: ["beta"], now: clock("2026-11-09T02:00:00.000Z") });
    expect(first.totals.restored).toBe(1);
    expect(store.objects.get("refresh/018/beta/coverage.json")).toEqual(original);
    const second = await runRefreshRequeueRestore(store,
      { who: "op@test", dryRun: false, stamp, cities: ["beta"], now: clock("2026-11-09T03:00:00.000Z") });
    expect(second.totals.restored).toBe(1);
    expect(store.objects.get("refresh/018/beta/coverage.json")).toEqual(original);
  });

  it("maxPerRun caps the whole run across cities; filters land in the trace", async () => {
    const store = await seededStore();
    const trace = await runRefreshRequeueAbandoned(store, {
      who: "cronjob:test", dryRun: false, maxPerRun: 1, maxPerCity: 5, maxAgeDays: 90,
      now: clock("2026-11-09T00:00:00.000Z") });
    expect(trace.totals.requeued).toBe(1);
    expect(trace.filters).toEqual({ maxAgeDays: 90, maxPerRun: 1, maxPerCity: 5 });
  });

  it("city and since filters combine; an absent city is skipped, never created", async () => {
    const store = await seededStore();
    const trace = await runRefreshRequeueAbandoned(store, {
      who: "op@test", dryRun: false, cities: ["alpha", "missing-city"],
      since: new Date("2026-11-01T00:00:00.000Z"), now: clock("2026-11-09T00:00:00.000Z") });

    expect(trace.totals).toEqual({ cities: 2, requeued: 0, skipped: 1 });
    expect(store.objects.has("refresh/018/missing-city/coverage.json")).toBe(false);
  });
});
