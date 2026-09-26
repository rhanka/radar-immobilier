// =============================================================================
// github.mjs — GitHub API seam of the e2e orchestrator (dispatch, run status,
// artefacts, workflow file). fetch + unzip injectable (the selftest uses fakes).
//
// Tokens: immo leg = the orchestrator's GITHUB_TOKEN (same repo, actions:write);
// geo leg = GEO_DISPATCH_TOKEN (environment radar-e2e, main-only): fine-grained
// token on rhanka/geo with Actions read/write + Contents read. A token is never
// logged; a missing geo token fails closed before any dispatch.
// =============================================================================
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL } from "node:url";

const API = "https://api.github.com";

export function tokenFor(env, tenant) {
  if (tenant === "geo") {
    if (!env.GEO_DISPATCH_TOKEN) {
      throw new Error("GEO_DISPATCH_TOKEN is not set (environment radar-e2e): cross-repo dispatch of rhanka/geo needs a token " +
        "with Actions read/write + Contents read on rhanka/geo (owner provisions it). Nothing was dispatched.");
    }
    return env.GEO_DISPATCH_TOKEN;
  }
  const t = env.GH_TOKEN_IMMO || env.GITHUB_TOKEN;
  if (!t) throw new Error("GH_TOKEN_IMMO (the workflow GITHUB_TOKEN, actions:write) is not set");
  return t;
}

// Extract one named file from a zip with the native `unzip` binary (0 python).
export function unzipFile(zipBuffer, name) {
  const dir = mkdtempSync(join(tmpdir(), "bascule2-zip-"));
  try {
    const zip = join(dir, "a.zip");
    writeFileSync(zip, zipBuffer, { mode: 0o600 });
    const r = spawnSync("unzip", ["-p", zip, name], { maxBuffer: 256 * 1024 * 1024 });
    if (r.error) throw new Error(`unzip unavailable: ${r.error.message}`);
    if (r.status !== 0) return null; // file absent from the artefact
    return Buffer.from(r.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export class GithubClient {
  constructor({ env, legs, fetchImpl = globalThis.fetch, unzip = unzipFile }) {
    this.env = env;
    this.legs = legs;
    this.fetch = fetchImpl;
    this.unzip = unzip;
    if (typeof this.fetch !== "function") throw new Error("global fetch unavailable (Node >= 18)");
  }

  headers(tenant, accept = "application/vnd.github+json") {
    return { Accept: accept, Authorization: `Bearer ${tokenFor(this.env, tenant)}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "bascule-e2e-orchestrator" };
  }

  async json(tenant, url) {
    const res = await this.fetch(url, { headers: this.headers(tenant) });
    if (!res.ok) throw new Error(`${tenant}: GET ${new URL(url).pathname} → HTTP ${res.status}`);
    return res.json();
  }

  async workflowFile(tenant) {
    const { repo, workflow, ref } = this.legs[tenant];
    const url = `${API}/repos/${repo}/contents/.github/workflows/${encodeURIComponent(workflow)}?ref=${encodeURIComponent(ref)}`;
    const res = await this.fetch(url, { headers: this.headers(tenant, "application/vnd.github.raw+json") });
    if (!res.ok) throw new Error(`${tenant}: workflow file ${repo}/${workflow}@${ref} → HTTP ${res.status}`);
    return res.text();
  }

  async dispatch(tenant, inputs) {
    const { repo, workflow, ref } = this.legs[tenant];
    const res = await this.fetch(`${API}/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`, {
      method: "POST",
      headers: { ...this.headers(tenant), "Content-Type": "application/json" },
      body: JSON.stringify({ ref, inputs }),
    });
    if (res.status !== 204) throw new Error(`${tenant}: workflow_dispatch → HTTP ${res.status}`);
  }

  async recentRuns(tenant, sinceIso) {
    const { repo, workflow, ref } = this.legs[tenant];
    const url = new URL(`${API}/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/runs`);
    url.searchParams.set("event", "workflow_dispatch");
    url.searchParams.set("branch", ref);
    url.searchParams.set("created", `>=${sinceIso}`);
    url.searchParams.set("per_page", "30");
    const data = await this.json(tenant, url.toString());
    return data.workflow_runs || [];
  }

  async run(tenant, runId) {
    const { repo } = this.legs[tenant];
    return this.json(tenant, `${API}/repos/${repo}/actions/runs/${runId}`);
  }

  // One named file of one named artefact of a run; null when absent.
  async artefactFile(tenant, runId, artefactName, fileName) {
    const { repo } = this.legs[tenant];
    const list = await this.json(tenant, `${API}/repos/${repo}/actions/runs/${runId}/artifacts?per_page=100`);
    const art = (list.artifacts || []).find((a) => a.name === artefactName && !a.expired);
    if (!art) return null;
    const res = await this.fetch(art.archive_download_url, { headers: this.headers(tenant) });
    if (!res.ok) throw new Error(`${tenant}: artefact ${artefactName} download → HTTP ${res.status}`);
    return this.unzip(Buffer.from(await res.arrayBuffer()), fileName);
  }
}
