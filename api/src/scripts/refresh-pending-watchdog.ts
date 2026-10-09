/**
 * refresh-pending-watchdog — fails a refresh pass whose pod never starts.
 *
 * Incident 2026-10-09: the prod and preprod `radar-refresh-pv` pods asked for
 * their RWO keyring volume on the same node in the same minute; the CSI attach
 * timed out, then reported "already attached" and never reconciled. Both pods
 * stayed Pending (Init:0/1) for 4 h 30 while holding their CPU requests, and
 * the prod release backup could not be scheduled.
 *
 * Kubernetes has no native bound on the Pending phase: the Job's
 * `activeDeadlineSeconds` (5 h 30 here) counts from the Job start, so it covers
 * Pending and Running alike and cannot be shortened without cutting a real
 * pass (up to ~4 h observed). Nothing inside the pod can run either: kubelet
 * mounts every volume before the first init container.
 *
 * So this runs OUTSIDE the refresh pod, as its own small CronJob, with a
 * ServiceAccount that can only get/list/delete pods in its namespace. Each run:
 *   1. lists the pods carrying the refresh pod label (REFRESH_WATCHDOG_POD_SELECTOR);
 *   2. keeps those owned by a Job whose name starts with REFRESH_WATCHDOG_JOB_PREFIX,
 *      still in phase Pending, not already being deleted, created at least
 *      REFRESH_PENDING_DEADLINE_SECONDS ago;
 *   3. deletes each of them with a uid precondition (never a recreated pod).
 *
 * A deleted, non-terminal pod counts as a failure for the Job controller; the
 * refresh Job has `backoffLimit: 0`, so the Job turns Failed at once, without a
 * replacement pod, and the pod's requests are released when the kubelet
 * confirms termination. A Running pod is never touched: the maximum duration
 * of a real pass is unchanged.
 *
 * Exit 0 after a clean run (with or without deletions), 1 on any API or
 * configuration error, so the watchdog Job itself turns red.
 */
import { readFileSync } from "node:fs";
import { request } from "node:https";

export interface WatchdogConfig {
  readonly deadlineSeconds: number;
  readonly jobPrefix: string;
  readonly selector: string;
}

export interface PodSummary {
  readonly name: string;
  readonly uid: string;
  readonly phase: string;
  readonly createdAtMs: number;
  readonly deleting: boolean;
  readonly ownerJob: string | null;
}

export interface KubePodApi {
  listPods(selector: string): Promise<unknown>;
  deletePod(name: string, uid: string): Promise<void>;
}

export interface WatchdogReport {
  readonly checked: number;
  readonly pending: number;
  readonly removed: string[];
}

export function readWatchdogConfig(env: Record<string, string | undefined>): WatchdogConfig {
  const rawDeadline = env.REFRESH_PENDING_DEADLINE_SECONDS ?? "";
  if (!/^[0-9]+$/.test(rawDeadline) || Number(rawDeadline) < 60) {
    throw new Error("REFRESH_PENDING_DEADLINE_SECONDS must be an integer number of seconds >= 60");
  }
  const jobPrefix = (env.REFRESH_WATCHDOG_JOB_PREFIX ?? "").trim();
  if (!jobPrefix) throw new Error("REFRESH_WATCHDOG_JOB_PREFIX is required");
  const selector = (env.REFRESH_WATCHDOG_POD_SELECTOR ?? "").trim();
  if (!/^[A-Za-z0-9./_-]+=[A-Za-z0-9._-]+$/.test(selector)) {
    throw new Error("REFRESH_WATCHDOG_POD_SELECTOR must be one equality selector key=value");
  }
  return { deadlineSeconds: Number(rawDeadline), jobPrefix, selector };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function parsePods(list: unknown): PodSummary[] {
  const items = record(list).items;
  if (!Array.isArray(items)) throw new Error("Kubernetes API did not return a PodList");
  return items.map((item) => {
    const metadata = record(record(item).metadata);
    const owners = Array.isArray(metadata.ownerReferences) ? metadata.ownerReferences : [];
    const job = owners.map(record).find((owner) => owner.kind === "Job");
    return {
      name: text(metadata.name),
      uid: text(metadata.uid),
      phase: text(record(record(item).status).phase),
      createdAtMs: Date.parse(text(metadata.creationTimestamp)),
      deleting: Boolean(metadata.deletionTimestamp),
      ownerJob: job ? text(job.name) || null : null,
    };
  });
}

export function selectStalledPods(pods: readonly PodSummary[], nowMs: number, config: WatchdogConfig): PodSummary[] {
  return pods.filter((pod) =>
    pod.phase === "Pending"
    && !pod.deleting
    && pod.name !== ""
    && pod.uid !== ""
    && pod.ownerJob !== null
    && pod.ownerJob.startsWith(config.jobPrefix)
    && Number.isFinite(pod.createdAtMs)
    && nowMs - pod.createdAtMs >= config.deadlineSeconds * 1000);
}

export async function runWatchdog(
  api: KubePodApi,
  config: WatchdogConfig,
  nowMs: number,
  log: (line: string) => void,
): Promise<WatchdogReport> {
  const pods = parsePods(await api.listPods(config.selector));
  const stalled = selectStalledPods(pods, nowMs, config);
  const removed: string[] = [];
  for (const pod of stalled) {
    const ageSeconds = Math.floor((nowMs - pod.createdAtMs) / 1000);
    log(`refresh-pending-watchdog: deleting pod ${pod.name} (Job ${pod.ownerJob}): `
      + `pending ${ageSeconds} s >= ${config.deadlineSeconds} s`);
    await api.deletePod(pod.name, pod.uid);
    removed.push(pod.name);
  }
  const report = { checked: pods.length, pending: pods.filter((pod) => pod.phase === "Pending").length, removed };
  log(`refresh-pending-watchdog: ${JSON.stringify(report)}`);
  return report;
}

const SA_DIR = "/var/run/secrets/kubernetes.io/serviceaccount";

function inClusterApi(): KubePodApi {
  const host = process.env.KUBERNETES_SERVICE_HOST;
  const port = process.env.KUBERNETES_SERVICE_PORT ?? "443";
  if (!host) throw new Error("KUBERNETES_SERVICE_HOST is not set: not running in a pod");
  const token = readFileSync(`${SA_DIR}/token`, "utf8").trim();
  const ca = readFileSync(`${SA_DIR}/ca.crt`);
  const namespace = readFileSync(`${SA_DIR}/namespace`, "utf8").trim();
  const base = `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods`;

  function call(method: string, path: string, body?: string): Promise<{ status: number; text: string }> {
    return new Promise((resolve, reject) => {
      const req = request({
        host, port, method, path, ca, timeout: 30_000,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {}),
        },
      }, (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => { data += chunk; });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text: data }));
      });
      req.on("timeout", () => req.destroy(new Error(`${method} ${path}: timeout`)));
      req.on("error", reject);
      if (body) req.write(body);
      req.end();
    });
  }

  return {
    async listPods(selector) {
      const res = await call("GET", `${base}?labelSelector=${encodeURIComponent(selector)}`);
      if (res.status !== 200) throw new Error(`list pods: HTTP ${res.status} ${res.text.slice(0, 200)}`);
      return JSON.parse(res.text) as unknown;
    },
    async deletePod(name, uid) {
      const body = JSON.stringify({ apiVersion: "v1", kind: "DeleteOptions", preconditions: { uid } });
      const res = await call("DELETE", `${base}/${encodeURIComponent(name)}`, body);
      // 404: already gone; 409: the uid precondition no longer matches (another pod).
      if (res.status === 404 || res.status === 409) return;
      if (res.status < 200 || res.status > 299) {
        throw new Error(`delete pod ${name}: HTTP ${res.status} ${res.text.slice(0, 200)}`);
      }
    },
  };
}

async function main(): Promise<void> {
  const config = readWatchdogConfig(process.env);
  await runWatchdog(inClusterApi(), config, Date.now(), (line) => console.log(line));
}

if (process.argv[1]?.endsWith("refresh-pending-watchdog.js")) {
  main().catch((error: unknown) => {
    console.error(`refresh-pending-watchdog: FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
