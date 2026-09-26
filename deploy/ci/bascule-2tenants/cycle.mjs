// =============================================================================
// cycle.mjs — pure identity + shared-state model for the 2-tenant e2e bascule.
//
// The e2e orchestrator (cycle-orchestrator.mjs) ORCHESTRATES the two per-tenant
// bascule workflows (immo + geo) around ONE coherence identity `CYCLE_ID` and a
// shared-state artefact `cycle.json`. This module holds ONLY pure, side-effect-
// free helpers (no k8s, no S3, no DB, no network) so they are unit-testable and
// deterministic:
//   - CYCLE_ID generation + RFC1123 sanitiser (SPEC §1.1),
//   - the LOCKED cycle.json schema (coordinator contract 2026-09-25, point 4),
//   - leg merge + join_verify transitions.
//
// SPEC of reference: docs/spec/reports/SPEC_ORCH_BASCULE_2TENANTS_COHERENCE.md
// (ratified design contract). The dispatch mechanism was later LOCKED to GitHub
// workflow_dispatch of BOTH legs (see dispatch.mjs / join-verify.mjs seams).
// =============================================================================

export const TENANTS = Object.freeze(["immo", "geo"]);

// RFC1123 label sanitiser (mirrors bascule.mjs refreshJobName): lowercase, keep
// only [a-z0-9-], trim leading/trailing dashes, bound to 63 chars, never a
// trailing dash after truncation. CYCLE_ID doubles as an S3 key segment AND a
// k8s Job name component, so it MUST be RFC1123-safe.
export function sanitizeRfc1123(value) {
  const clean = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+|-+$/g, "");
  return clean.slice(0, 63).replace(/-+$/g, "");
}

// CONFIRM contract (GARDE G3, bascule.mjs assertConfirm): iso-prod-AAAA-MM-JJ.
export const CONFIRM_RE = /^iso-prod-\d{4}-\d{2}-\d{2}$/;

// CYCLE_ID = <CONFIRM>-<nonce>, nonce = base36 of the T0 epoch SECONDS. Derivable
// from T0, unique per second, anti-replay within a same-day CONFIRM (SPEC §1.1).
export function makeCycleId(confirm, t0Ms) {
  if (!CONFIRM_RE.test(String(confirm ?? ""))) {
    throw new Error(`makeCycleId: CONFIRM must match iso-prod-AAAA-MM-JJ, got '${confirm}'`);
  }
  const t0 = Number(t0Ms);
  if (!Number.isFinite(t0) || t0 <= 0) {
    throw new Error(`makeCycleId: t0Ms must be a positive epoch-ms, got '${t0Ms}'`);
  }
  const nonce = Math.floor(t0 / 1000).toString(36);
  // Defence in depth: pass through the sanitiser (no-op on this already-clean form).
  return sanitizeRfc1123(`${confirm}-${nonce}`);
}

// Fail-closed CYCLE_ID validation (RFC1123 label, <=63, alphanumeric ends).
const RFC1123_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
export function assertCycleId(cycleId) {
  const s = String(cycleId ?? "");
  if (!RFC1123_RE.test(s)) {
    throw new Error(`assertCycleId: '${s}' is not a valid RFC1123 label (<=63, [a-z0-9-], alnum ends)`);
  }
  return s;
}

// ── LOCKED cycle.json schema (coordinator 2026-09-25, point 4) ───────────────
// Each leg writes its own `legs.<tenant>` sub-branch (published as a per-leg
// artefact `cycle-leg-<tenant>-<CYCLE_ID>`); the orchestrator merges them and
// computes `join_verify`.
export function emptyVerdict() {
  return { pg: "pending", s3: "pending" };
}

export function emptyLeg({ repo = "", workflow = "" } = {}) {
  return {
    repo,
    workflow,
    run_id: null,
    sha_main: null,
    t1: null,
    verdict: emptyVerdict(),
    served_ids_artifact: null,
    served_ids_sha256: null,
  };
}

export function newCycle({ cycleId, confirm, orchestratorRunId = null, createdAt, legs = {} } = {}) {
  assertCycleId(cycleId);
  if (!CONFIRM_RE.test(String(confirm ?? ""))) {
    throw new Error(`newCycle: CONFIRM must match iso-prod-AAAA-MM-JJ, got '${confirm}'`);
  }
  const created = createdAt || new Date().toISOString();
  return {
    cycle_id: cycleId,
    confirm,
    created_at: created,
    orchestrator_run_id: orchestratorRunId,
    legs: {
      immo: { ...emptyLeg(), ...(legs.immo || {}) },
      geo: { ...emptyLeg(), ...(legs.geo || {}) },
    },
    join_verify: { status: "pending", compared_at: null, diff_summary: null },
  };
}

// Merge a per-leg sub-branch into the cycle (idempotent shallow-merge; verdict is
// merged field-wise so a partial verdict update never clobbers the other check).
export function setLeg(cycle, tenant, leg) {
  if (!TENANTS.includes(tenant)) throw new Error(`setLeg: unknown tenant '${tenant}'`);
  const prev = cycle.legs[tenant] || emptyLeg();
  cycle.legs[tenant] = {
    ...prev,
    ...leg,
    verdict: { ...prev.verdict, ...(leg && leg.verdict ? leg.verdict : {}) },
  };
  return cycle;
}

const JOIN_STATUSES = Object.freeze(["pending", "match", "drift"]);
export function setJoinVerify(cycle, { status, comparedAt = new Date().toISOString(), diffSummary = null }) {
  if (!JOIN_STATUSES.includes(status)) throw new Error(`setJoinVerify: invalid status '${status}'`);
  cycle.join_verify = { status, compared_at: comparedAt, diff_summary: diffSummary };
  return cycle;
}

// Structural validation (shape only; not a semantic verdict). Throws on the first
// missing/invalid field so a corrupt merge fails closed before dispatch/flip.
export function validateCycle(cycle) {
  const errs = [];
  if (!cycle || typeof cycle !== "object") errs.push("cycle is not an object");
  else {
    if (!RFC1123_RE.test(String(cycle.cycle_id ?? ""))) errs.push("cycle_id invalid");
    if (!CONFIRM_RE.test(String(cycle.confirm ?? ""))) errs.push("confirm invalid");
    if (!cycle.created_at) errs.push("created_at missing");
    for (const t of TENANTS) {
      const leg = cycle.legs && cycle.legs[t];
      if (!leg || typeof leg !== "object") { errs.push(`legs.${t} missing`); continue; }
      if (!leg.verdict || !("pg" in leg.verdict) || !("s3" in leg.verdict)) errs.push(`legs.${t}.verdict incomplete`);
    }
    if (!cycle.join_verify || !JOIN_STATUSES.includes(cycle.join_verify.status)) errs.push("join_verify.status invalid");
  }
  if (errs.length) throw new Error(`validateCycle: ${errs.join("; ")}`);
  return cycle;
}
