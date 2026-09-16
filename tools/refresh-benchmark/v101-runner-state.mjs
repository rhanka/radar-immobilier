import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const terminalNetworkReplayCodes = new Set(["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "ENOTFOUND",
  "EAI_AGAIN", "ECONNRESET"]);

export function artifactPaths(root, documentId, arm, attempt) {
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > 4) {
    throw new Error("Attempt must be an integer between 1 and 4");
  }
  const stem = `${documentId}--${arm}.attempt-${attempt}`;
  return Object.freeze({ stem, intent: resolve(root, `${stem}.intent.json`),
    receipt: resolve(root, `${stem}.receipt.json`), raw: resolve(root, `${stem}.raw.txt`),
    output: resolve(root, `${stem}.output.json`) });
}

async function jsonIfPresent(path) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}

function isTerminalNetworkFailure(receipt) {
  if (receipt.status !== "failed") return false;
  const code = String(receipt.error?.code ?? receipt.error?.cause?.code ?? "").toUpperCase();
  return receipt.error?.category === "network" || terminalNetworkReplayCodes.has(code)
    || code.includes("TLS");
}

export async function resumeDecision(root, documentId, arm) {
  const terminalNetworkReplay = process.env.BENCHMARK_RETRY_NETWORK_TERMINAL === "1";
  const attempts = terminalNetworkReplay ? [4, 3, 2, 1] : [2, 1];
  for (const attempt of attempts) {
    const paths = artifactPaths(root, documentId, arm, attempt);
    const receipt = await jsonIfPresent(paths.receipt);
    if (receipt) {
      if (terminalNetworkReplay && attempt < 4 && isTerminalNetworkFailure(receipt)) {
        return { action: "run", attempt: attempt + 1, previous: receipt,
          paths: artifactPaths(root, documentId, arm, attempt + 1) };
      }
      const terminal = receipt.status === "completed" || !receipt.retry?.eligible || attempt >= 2;
      return terminal ? { action: "skip", attempt, receipt, paths }
        : { action: "run", attempt: 2, previous: receipt,
          paths: artifactPaths(root, documentId, arm, 2) };
    }
    if (await jsonIfPresent(paths.intent)) {
      throw new Error(`Uncertain in-flight state: ${paths.intent}`);
    }
  }
  return { action: "run", attempt: 1, previous: null,
    paths: artifactPaths(root, documentId, arm, 1) };
}

export async function releaseRateLimitIntent(root, documentId, arm) {
  for (const attempt of [2, 1]) {
    const paths = artifactPaths(root, documentId, arm, attempt);
    const [intent, receipt] = await Promise.all([
      jsonIfPresent(paths.intent), jsonIfPresent(paths.receipt),
    ]);
    if (!intent || receipt) continue;
    if (intent.state !== "in-flight" || intent.documentId !== documentId || intent.arm !== arm) {
      throw new Error(`Invalid suspended intent: ${paths.intent}`);
    }
    await rm(paths.intent);
    return true;
  }
  return false;
}

export async function writeIntent(paths, value) {
  await mkdir(dirname(paths.intent), { recursive: true });
  try { await writeFile(paths.intent, `${JSON.stringify(value)}\n`, { flag: "wx" }); }
  catch (error) {
    if (error?.code !== "EEXIST") throw error;
    if (await jsonIfPresent(paths.receipt)) return false;
    throw new Error(`Uncertain in-flight state: ${paths.intent}`);
  }
  return true;
}

export async function writeImmutable(path, value, raw = false) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, raw ? value : `${JSON.stringify(value)}\n`, { flag: "wx" });
}

export function classifyFailure({ httpStatus = null, code = null, terminalSse = null } = {}) {
  if (code === "REQUEST_BUDGET_SUSPENDED") {
    return { category: "request-budget", retry: false, suspend: true };
  }
  if (httpStatus === 429) return { category: "rate-limit", retry: false, suspend: true };
  if ([408, 425].includes(httpStatus) || (httpStatus >= 500 && httpStatus <= 599)) {
    return { category: "http-retryable", retry: true, suspend: false };
  }
  if (terminalSse?.expected && !terminalSse.terminal) {
    return { category: "stream-without-terminal", retry: true, suspend: false };
  }
  if (httpStatus >= 400) return { category: "http-terminal", retry: false, suspend: false };
  const normalizedCode = String(code ?? "").toUpperCase();
  const networkCodes = new Set(["ABORT_ERR", "ECONNRESET", "ECONNREFUSED", "ENOTFOUND",
    "EAI_AGAIN", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT"]);
  if (networkCodes.has(normalizedCode) || normalizedCode === "NETWORK_ERROR"
    || normalizedCode === "TRANSPORT_ERROR") {
    return { category: "network", retry: true, suspend: false };
  }
  return { category: "terminal", retry: false, suspend: false };
}

export function advanceCircuit(current = {}, code, threshold) {
  if (!Number.isInteger(threshold) || threshold < 1) throw new Error("Invalid circuit threshold");
  if (current.open) return current;
  if (!code) return { code: null, consecutive: 0, open: false };
  const consecutive = current.code === code ? Number(current.consecutive ?? 0) + 1 : 1;
  return { code, consecutive, open: consecutive >= threshold };
}

export function laneCircuitAction(lane, circuit) {
  return circuit.open && lane === "codex" ? "stop-lane" : "continue";
}

export function laneConcurrency(lane, codexClear, configured) {
  const raw = configured === undefined ? process.env.BENCHMARK_LANE_CONCURRENCY : configured;
  if (raw !== undefined && raw !== "") {
    const value = Number(raw);
    const maximum = lane === "codex" ? 2 : 3;
    if (!Number.isInteger(value) || value < 1 || value > maximum) {
      throw new Error(`BENCHMARK_LANE_CONCURRENCY must be between 1 and ${maximum}`);
    }
    return value;
  }
  return lane === "codex" && codexClear ? 2 : 1;
}

export function providerGatePassed(outcomes, requiredRequests) {
  return outcomes.length === requiredRequests
    && outcomes.every((outcome) => outcome.requestCount === 1 && outcome.accepted === true);
}

export function replayTransportGatePassed(outcomes, requiredRequests) {
  const minimumValid = Math.ceil(requiredRequests * 2 / 3);
  return outcomes.length === requiredRequests
    && outcomes.every((outcome) => outcome.requestCount === 1 && outcome.httpStatus !== 400)
    && outcomes.filter((outcome) => outcome.httpStatus === 200 && outcome.jsonValid).length
      >= minimumValid;
}

export function retryAt(headers, now = Date.now()) {
  const retryAfter = headers?.["retry-after"];
  if (retryAfter && /^\d+(?:\.\d+)?$/u.test(retryAfter)) {
    return new Date(now + Number(retryAfter) * 1_000).toISOString();
  }
  if (retryAfter && Number.isFinite(Date.parse(retryAfter))) {
    return new Date(Date.parse(retryAfter)).toISOString();
  }
  for (const name of ["x-ratelimit-reset-requests", "x-ratelimit-reset-tokens"]) {
    const match = String(headers?.[name] ?? "").match(/^(\d+(?:\.\d+)?)(ms|s|m)$/u);
    if (match) {
      const scale = { ms: 1, s: 1_000, m: 60_000 }[match[2]];
      return new Date(now + Number(match[1]) * scale).toISOString();
    }
  }
  return null;
}

export function rateLimitPlan(headers, consecutive = 0, now = Date.now()) {
  const next = Number(consecutive) + 1;
  const resetAt = retryAt(headers, now);
  const fallbackMs = next === 1 ? 300_000 : 900_000;
  const providerMs = resetAt === null ? fallbackMs
    : Math.max(0, Date.parse(resetAt) - now) + 250;
  const boundedMs = Math.min(providerMs, 900_000);
  const yieldLane = next >= 3;
  const waitMs = yieldLane ? 0 : boundedMs;
  return { consecutive: next, resetAt,
    resumeAt: new Date(now + boundedMs).toISOString(), waitMs, yieldLane };
}

export function resetRateLimitState() {
  return { consecutive: 0, resumeAt: null };
}

export async function updateCampaignStatus(path, mutate, clock = () => Date.now()) {
  const lock = `${path}.lock`;
  await mkdir(dirname(path), { recursive: true });
  for (let count = 0;; count += 1) {
    try { await mkdir(lock); break; }
    catch (error) {
      if (error?.code !== "EEXIST" || count >= 200) throw error;
      await delay(25);
    }
  }
  try {
    const status = await jsonIfPresent(path) ?? { schemaVersion: 1,
      campaign: process.env.BENCHMARK_CAMPAIGN ?? "v101", arms: {} };
    const updated = mutate(status) ?? status;
    updated.updatedAt = new Date(clock()).toISOString();
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(updated, null, 2)}\n`);
    await rename(temporary, path);
    return updated;
  } finally { await rm(lock, { recursive: true, force: true }); }
}

export async function updateGlobalStatus(path, armName, mutate, clock = () => Date.now()) {
  const status = await updateCampaignStatus(path, (current) => {
    current.arms[armName] = mutate(current.arms[armName] ?? {});
    return current;
  }, clock);
  return status.arms[armName];
}
