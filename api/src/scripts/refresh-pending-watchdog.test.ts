import { describe, expect, it } from "vitest";
import {
  parsePods,
  readWatchdogConfig,
  runWatchdog,
  selectStalledPods,
  type DeleteOutcome,
  type KubePodApi,
  type WatchdogConfig,
} from "./refresh-pending-watchdog.js";

const NOW = Date.parse("2026-10-09T05:20:00Z");
const CONFIG: WatchdogConfig = {
  deadlineSeconds: 900,
  jobPrefix: "radar-refresh-pv-",
  selector: "app.kubernetes.io/instance=radar-refresh-pv",
};

function pod(name: string, phase: string, createdAt: string, extra: Record<string, unknown> = {}) {
  return {
    metadata: {
      name,
      uid: `uid-${name}`,
      resourceVersion: `rv-${name}`,
      creationTimestamp: createdAt,
      ownerReferences: [{ kind: "Job", name: name.replace(/-[a-z0-9]{5}$/, "") }],
      ...extra,
    },
    status: { phase },
  };
}

describe("readWatchdogConfig", () => {
  it("reads the deadline, the owner Job prefix and the pod selector", () => {
    expect(readWatchdogConfig({
      REFRESH_PENDING_DEADLINE_SECONDS: "900",
      REFRESH_WATCHDOG_JOB_PREFIX: "radar-refresh-pv-",
      REFRESH_WATCHDOG_POD_SELECTOR: "app.kubernetes.io/instance=radar-refresh-pv",
    })).toEqual(CONFIG);
  });

  it.each([
    [{}, "REFRESH_PENDING_DEADLINE_SECONDS"],
    [{ REFRESH_PENDING_DEADLINE_SECONDS: "59" }, "REFRESH_PENDING_DEADLINE_SECONDS"],
    [{ REFRESH_PENDING_DEADLINE_SECONDS: "15m" }, "REFRESH_PENDING_DEADLINE_SECONDS"],
    [{ REFRESH_PENDING_DEADLINE_SECONDS: "900" }, "REFRESH_WATCHDOG_JOB_PREFIX"],
    [{ REFRESH_PENDING_DEADLINE_SECONDS: "900", REFRESH_WATCHDOG_JOB_PREFIX: "radar-refresh-pv-" },
      "REFRESH_WATCHDOG_POD_SELECTOR"],
    [{ REFRESH_PENDING_DEADLINE_SECONDS: "900", REFRESH_WATCHDOG_JOB_PREFIX: "radar-refresh-pv-",
      REFRESH_WATCHDOG_POD_SELECTOR: "radar-refresh-pv" }, "REFRESH_WATCHDOG_POD_SELECTOR"],
  ])("refuses an incomplete or invalid configuration (%j)", (env, name) => {
    expect(() => readWatchdogConfig(env)).toThrow(name);
  });
});

describe("selectStalledPods", () => {
  it("selects only a refresh pod still Pending past the deadline", () => {
    const pods = parsePods({
      items: [
        pod("radar-refresh-pv-29811300-aaaaa", "Pending", "2026-10-09T05:00:00Z"),
        pod("radar-refresh-pv-29811301-bbbbb", "Pending", "2026-10-09T05:10:00Z"),
        pod("radar-refresh-pv-29811302-ccccc", "Running", "2026-10-09T01:00:00Z"),
        pod("radar-refresh-pv-29811303-ddddd", "Pending", "2026-10-09T04:00:00Z",
          { deletionTimestamp: "2026-10-09T05:19:00Z" }),
        pod("radar-other-29811304-eeeee", "Pending", "2026-10-09T04:00:00Z"),
        pod("radar-refresh-pv-29811305-fffff", "Succeeded", "2026-10-09T00:00:00Z"),
      ],
    });
    expect(selectStalledPods(pods, NOW, CONFIG).map((item) => item.name))
      .toEqual(["radar-refresh-pv-29811300-aaaaa"]);
  });

  it("keeps a pod exactly at the deadline boundary eligible", () => {
    const pods = parsePods({ items: [pod("radar-refresh-pv-1-aaaaa", "Pending", "2026-10-09T05:05:00Z")] });
    expect(selectStalledPods(pods, NOW, CONFIG)).toHaveLength(1);
  });

  it("never selects a pod without a Job owner or with an unreadable creation time", () => {
    const pods = parsePods({
      items: [
        { metadata: { name: "radar-refresh-pv-orphan", uid: "u1", creationTimestamp: "2026-10-09T04:00:00Z" },
          status: { phase: "Pending" } },
        pod("radar-refresh-pv-2-bbbbb", "Pending", "not-a-date"),
      ],
    });
    expect(selectStalledPods(pods, NOW, CONFIG)).toEqual([]);
  });

  it("refuses a pod list that is not a Kubernetes list", () => {
    expect(() => parsePods({ kind: "Status" })).toThrow("PodList");
  });
});

describe("runWatchdog", () => {
  function fakeApi(items: unknown[], failDelete = false, outcome: DeleteOutcome = "accepted") {
    const calls: string[] = [];
    const api: KubePodApi = {
      async listPods(selector) {
        calls.push(`list ${selector}`);
        return { items };
      },
      async deletePod(name, uid, resourceVersion) {
        calls.push(`delete ${name} ${uid} ${resourceVersion}`);
        if (failDelete) throw new Error("forbidden");
        return outcome;
      },
    };
    return { api, calls };
  }

  it("deletes each stalled pod with a uid precondition and reports it", async () => {
    const { api, calls } = fakeApi([
      pod("radar-refresh-pv-29811300-aaaaa", "Pending", "2026-10-09T05:00:00Z"),
      pod("radar-refresh-pv-29811330-bbbbb", "Running", "2026-10-09T05:01:00Z"),
    ]);
    const lines: string[] = [];
    const report = await runWatchdog(api, CONFIG, NOW, (line) => lines.push(line));
    expect(calls).toEqual([
      "list app.kubernetes.io/instance=radar-refresh-pv",
      "delete radar-refresh-pv-29811300-aaaaa uid-radar-refresh-pv-29811300-aaaaa rv-radar-refresh-pv-29811300-aaaaa",
    ]);
    expect(report).toEqual({ checked: 2, pending: 1, deletionRequested: ["radar-refresh-pv-29811300-aaaaa"], skipped: [] });
    expect(lines.join("\n")).toContain("pending 1200 s >= 900 s");
  });

  it("does nothing when every refresh pod started", async () => {
    const { api, calls } = fakeApi([pod("radar-refresh-pv-1-aaaaa", "Running", "2026-10-09T01:00:00Z")]);
    const report = await runWatchdog(api, CONFIG, NOW, () => undefined);
    expect(calls).toHaveLength(1);
    expect(report.deletionRequested).toEqual([]);
  });

  it("propagates a delete failure so the watchdog Job turns red", async () => {
    const { api } = fakeApi([pod("radar-refresh-pv-1-aaaaa", "Pending", "2026-10-09T04:00:00Z")], true);
    await expect(runWatchdog(api, CONFIG, NOW, () => undefined)).rejects.toThrow("forbidden");
  });
});

describe("runWatchdog — stale observations", () => {
  it.each([
    ["changed", "changed since the list"],
    ["gone", "already gone"],
  ] as const)("reports a %s pod as skipped, never as deleted", async (outcome, message) => {
    const calls: string[] = [];
    const api: KubePodApi = {
      async listPods() {
        return { items: [pod("radar-refresh-pv-1-aaaaa", "Pending", "2026-10-09T04:00:00Z")] };
      },
      async deletePod(name, uid, resourceVersion) {
        calls.push(`${name} ${uid} ${resourceVersion}`);
        return outcome;
      },
    };
    const lines: string[] = [];
    const report = await runWatchdog(api, CONFIG, NOW, (line) => lines.push(line));
    expect(calls).toEqual(["radar-refresh-pv-1-aaaaa uid-radar-refresh-pv-1-aaaaa rv-radar-refresh-pv-1-aaaaa"]);
    expect(report.deletionRequested).toEqual([]);
    expect(report.skipped).toEqual(["radar-refresh-pv-1-aaaaa"]);
    expect(lines.join("\n")).toContain(message);
  });

  it("never selects a pod without a resourceVersion (no precondition possible)", () => {
    const pods = parsePods({ items: [{
      metadata: { name: "radar-refresh-pv-1-aaaaa", uid: "u1", creationTimestamp: "2026-10-09T04:00:00Z",
        ownerReferences: [{ kind: "Job", name: "radar-refresh-pv-1" }] },
      status: { phase: "Pending" },
    }] });
    expect(selectStalledPods(pods, NOW, CONFIG)).toEqual([]);
  });
});
