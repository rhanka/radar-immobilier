// =============================================================================
// dispatch.mjs — the "GEO LEG DISPATCH" seam (pluggable, typed).
//
// LOCKED contract (i-cond ⇄ geo-cond, 2026-09-25):
//   - The orchestrator dispatches BOTH legs by GitHub `workflow_dispatch`:
//       immo → rhanka/radar-immobilier .github/workflows/bascule-preprod.yml
//       geo  → rhanka/geo             .github/workflows/bascule-preprod.yml
//     with inputs { CONFIRM, DRY_RUN:false, SKIP_ROLLOUT:false, CYCLE_ID }.
//   - No h2a envelope, no Job launched by the orchestrator: each tenant's CI
//     drives its own cluster. The orchestrator only DISPATCHES (actions:write)
//     then FOLLOWS status STATUS-ONLY per job (`pg`, `s3`) via the GitHub API
//     (actions:read).
//   - Cross-repo dispatch of rhanka/geo needs actions:write on rhanka/geo, which
//     the default GITHUB_TOKEN does NOT carry → the geo leg reads a named secret
//     (GEO_DISPATCH_TOKEN, a fine-grained PAT / GitHub App). Provisioning that
//     secret is an owner/infra dependency for the REAL e2e run; the scaffold and
//     the draft PR do not depend on it.
//
// The seam stays pluggable: `InertDispatcher` is the documented default (does
// nothing, fails closed on use); `GithubWorkflowDispatcher` is the wired impl.
// =============================================================================

import process from "node:process";
import { URL } from "node:url";

/**
 * @typedef {Object} DispatchRequest
 * @property {"immo"|"geo"} tenant
 * @property {string} ref        git ref to run the workflow on (e.g. "main")
 * @property {Record<string,string>} inputs  workflow_dispatch inputs
 *
 * @typedef {Object} LegDispatcher
 * @property {(req: DispatchRequest) => Promise<{ dispatchedAt: string }>} dispatch
 * @property {(q: { tenant: string, cycleId: string, dispatchedAfter: string, ref: string }) => Promise<{ runId: number|null, htmlUrl?: string }>} findRun
 * @property {(q: { tenant: string, runId: number, jobNames: string[] }) => Promise<{ runStatus: string, jobs: Record<string,string> }>} pollJobs
 */

// Per-tenant leg configuration (repo + workflow file), locked contract.
export const LEG_DEFAULTS = Object.freeze({
  immo: { repo: "rhanka/radar-immobilier", workflow: "bascule-preprod.yml" },
  geo: { repo: "rhanka/geo", workflow: "bascule-preprod.yml" },
});

// Pure URL builders (unit-testable, no I/O).
export function dispatchUrl(repo, workflow) {
  return `https://api.github.com/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`;
}
export function workflowRunsUrl(repo, workflow) {
  return `https://api.github.com/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/runs`;
}
export function runJobsUrl(repo, runId) {
  return `https://api.github.com/repos/${repo}/actions/runs/${runId}/jobs`;
}

/**
 * Resolve the token a leg dispatches with. immo is same-repo (GITHUB_TOKEN);
 * geo is cross-repo and REQUIRES the named GEO_DISPATCH_TOKEN secret. Fail-closed
 * with an actionable message if the geo token is absent (coordinator point 5).
 */
export function resolveLegToken(env, tenant) {
  if (tenant === "geo") {
    const t = env.GEO_DISPATCH_TOKEN;
    if (!t) {
      throw new Error(
        "dispatch(geo): GEO_DISPATCH_TOKEN is not set. Cross-repo workflow_dispatch of rhanka/geo needs " +
          "actions:write on rhanka/geo (fine-grained PAT or GitHub App), which the default GITHUB_TOKEN lacks. " +
          "Provisioning this secret is an owner/infra dependency for the real e2e run.",
      );
    }
    return t;
  }
  const t = env.GEO_DISPATCH_TOKEN || env.GITHUB_TOKEN;
  if (!t) throw new Error("dispatch(immo): neither GITHUB_TOKEN nor GEO_DISPATCH_TOKEN is set (actions:write required).");
  return t;
}

// Map a GitHub job (status/conclusion) to a compact verdict token for cycle.json.
export function jobVerdict(job) {
  if (!job) return "unknown";
  if (job.status !== "completed") return job.status || "unknown"; // queued | in_progress
  return job.conclusion || "unknown"; // success | failure | cancelled | skipped | ...
}

// ── Inert default (documented, fails closed on use) ──────────────────────────
export class InertDispatcher {
  constructor(reason = "no dispatcher configured") {
    this.reason = reason;
  }
  async dispatch() {
    throw new Error(`InertDispatcher.dispatch: ${this.reason}. Configure GithubWorkflowDispatcher (BASCULE2_DISPATCH_MODE=github).`);
  }
  async findRun() {
    throw new Error(`InertDispatcher.findRun: ${this.reason}.`);
  }
  async pollJobs() {
    throw new Error(`InertDispatcher.pollJobs: ${this.reason}.`);
  }
}

// ── Wired impl: GitHub workflow_dispatch + STATUS-ONLY job polling ───────────
export class GithubWorkflowDispatcher {
  /**
   * @param {{ env?: Record<string,string>, legs?: typeof LEG_DEFAULTS, fetchImpl?: typeof fetch }} [opts]
   */
  constructor({ env = process.env, legs = LEG_DEFAULTS, fetchImpl } = {}) {
    this.env = env;
    this.legs = legs;
    this.fetch = fetchImpl || globalThis.fetch;
    if (typeof this.fetch !== "function") {
      throw new Error("GithubWorkflowDispatcher: global fetch unavailable (Node >= 18 required).");
    }
  }

  _headers(tenant) {
    return {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${resolveLegToken(this.env, tenant)}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "bascule-2tenants-orchestrator",
    };
  }

  async dispatch({ tenant, ref, inputs }) {
    const leg = this.legs[tenant];
    if (!leg) throw new Error(`dispatch: unknown tenant '${tenant}'`);
    const res = await this.fetch(dispatchUrl(leg.repo, leg.workflow), {
      method: "POST",
      headers: { ...this._headers(tenant), "Content-Type": "application/json" },
      body: JSON.stringify({ ref, inputs }),
    });
    if (res.status !== 204) {
      const body = await safeText(res);
      throw new Error(`dispatch(${tenant}): HTTP ${res.status} on workflow_dispatch — ${body}`);
    }
    return { dispatchedAt: new Date().toISOString() };
  }

  // GitHub does NOT return the run id created by a workflow_dispatch. We correlate
  // by (event=workflow_dispatch, ref, created >= dispatchedAfter) and take the
  // newest. PENDING refinement: once geo echoes CYCLE_ID in the run-name, match on
  // that instead of on time (tightens correlation under concurrency).
  async findRun({ tenant, dispatchedAfter, ref }) {
    const leg = this.legs[tenant];
    const url = new URL(workflowRunsUrl(leg.repo, leg.workflow));
    url.searchParams.set("event", "workflow_dispatch");
    if (ref) url.searchParams.set("branch", ref);
    url.searchParams.set("created", `>=${dispatchedAfter}`);
    url.searchParams.set("per_page", "20");
    const res = await this.fetch(url, { headers: this._headers(tenant) });
    if (!res.ok) throw new Error(`findRun(${tenant}): HTTP ${res.status} — ${await safeText(res)}`);
    const data = await res.json();
    const runs = (data && data.workflow_runs) || [];
    if (!runs.length) return { runId: null };
    runs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return { runId: runs[0].id, htmlUrl: runs[0].html_url };
  }

  async pollJobs({ tenant, runId, jobNames }) {
    const leg = this.legs[tenant];
    const res = await this.fetch(runJobsUrl(leg.repo, runId), { headers: this._headers(tenant) });
    if (!res.ok) throw new Error(`pollJobs(${tenant}): HTTP ${res.status} — ${await safeText(res)}`);
    const data = await res.json();
    const byName = new Map((data.jobs || []).map((j) => [j.name, j]));
    const jobs = {};
    for (const name of jobNames) jobs[name] = jobVerdict(byName.get(name));
    // Run-level status: 'completed' only when every requested job completed.
    const allDone = jobNames.every((n) => byName.get(n) && byName.get(n).status === "completed");
    return { runStatus: allDone ? "completed" : "in_progress", jobs };
  }
}

async function safeText(res) {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "<no body>";
  }
}

/**
 * Factory: choose the dispatcher implementation. Default is the wired GitHub impl;
 * BASCULE2_DISPATCH_MODE=inert selects the inert default (offline / scaffold).
 * @returns {LegDispatcher}
 */
export function makeDispatcher(env = process.env, { fetchImpl } = {}) {
  const mode = (env.BASCULE2_DISPATCH_MODE || "github").toLowerCase();
  if (mode === "inert") return new InertDispatcher("BASCULE2_DISPATCH_MODE=inert");
  return new GithubWorkflowDispatcher({ env, fetchImpl });
}
