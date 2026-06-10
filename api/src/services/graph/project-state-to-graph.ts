/**
 * WP A.3.1 — Project-state → graph converter.
 *
 * Converts a radar `OntologyProjectState` (canonicals + candidates + mentions)
 * into the `graphify` graph.json shape consumed by `upsertGraph`.
 *
 * Conversion rules (anti-invention — only what the state carries):
 *
 *  Nodes
 *  ─────
 *  · Each canonical entity → one node (id=canonical.id, type=canonical.type,
 *    label=canonical.label, citySlug from state).
 *  · Each mention that IS NOT already covered by a canonical member → a
 *    lightweight Source/mention node (captures "orphan" mentions not yet
 *    reconciled; omitted when the mention id is already a canonical member).
 *
 *  Edges
 *  ─────
 *  · Each reconciliation candidate (entity_match) → one `entity_match` edge
 *    between the two CANONICAL nodes the candidate ids map to (via their
 *    memberMentionId sets). If either side has no canonical, the edge is
 *    skipped (anti-invention: never fabricate an endpoint).
 *  · Each canonical whose memberMentionIds span > 1 source ref →
 *    `reconciled_as` edges from each member mention node to the canonical
 *    (only when the mention node exists, i.e. not collapsed away).
 *  · For every (Bylaw canonical, DesignationEvent canonical) pair that SHARE
 *    an evidence ref → one `concerns` edge (DesignationEvent → Bylaw). The
 *    shared ref is the evidence; zero shared refs = no edge (anti-invention).
 *
 * The output is deterministic and idempotent: same state → same graph every
 * time. No node or edge is fabricated; all data comes from the state verbatim.
 */

import type { OntologyProjectState } from "../exploitation/project-state.js";
import type { GraphifyGraph, GraphifyLink, GraphifyNode } from "./graph-store.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Map a canonical entity type to its graphify node type. */
function nodeType(type: string): string {
  // Known radar types: Zone, Bylaw, DesignationEvent, Lot, Valuation, Adresse, Source
  // Pass through verbatim (lowercase for consistency with graphify convention).
  return type.toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// Main converter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert a city's `OntologyProjectState` into a graphify `GraphifyGraph`.
 *
 * All data is derived strictly from the state (anti-invention). No field is
 * invented; absent evidence = absent edge.
 */
export function projectStateToGraph(state: OntologyProjectState): GraphifyGraph {
  const nodes: GraphifyNode[] = [];
  const links: GraphifyLink[] = [];

  // ── 1. Canonical nodes ───────────────────────────────────────────────────

  // Index: mention id → canonical id (used for edge routing)
  const mentionToCanonical = new Map<string, string>();
  for (const c of state.canonicals) {
    for (const mid of c.memberMentionIds) {
      mentionToCanonical.set(mid, c.id);
    }
  }

  for (const c of state.canonicals) {
    nodes.push({
      id: c.id,
      label: c.label,
      file_type: nodeType(c.type),
      source_file: c.evidenceRefs[0] ?? undefined,
    });
  }

  // ── 2. Mention nodes ─────────────────────────────────────────────────────
  //    Two cases:
  //    a) Multi-member canonical: each member mention is emitted as its own
  //       node so that `reconciled_as` edges have valid endpoints. These
  //       nodes represent the original pre-reconciliation evidence.
  //    b) Orphan mention (no canonical): emitted as a standalone node.
  //    Single-member canonicals: the canonical IS the mention — no separate
  //    mention node is emitted to avoid noise.

  // Set of mention ids that are single-member canonical members (skip them).
  const singleMemberMentionIds = new Set<string>(
    state.canonicals
      .filter((c) => c.memberMentionIds.length === 1)
      .flatMap((c) => c.memberMentionIds),
  );

  const mentionById = new Map(state.mentions.map((m) => [m.id, m]));

  for (const m of state.mentions) {
    // Skip single-member canonical members (fully represented by the canonical node).
    if (singleMemberMentionIds.has(m.id)) continue;
    nodes.push({
      id: m.id,
      label: m.label,
      file_type: nodeType(m.type),
      source_file: m.source_refs[0] ?? undefined,
    });
  }

  // ── 3. entity_match edges (reconciliation candidates) ────────────────────
  //    candidate_id / canonical_id are mention ids → resolve to canonical ids.
  for (const cand of state.candidates) {
    const srcCanon = mentionToCanonical.get(cand.candidate_id);
    const dstCanon = mentionToCanonical.get(cand.canonical_id);
    // Only emit if both endpoints resolved to a canonical node (anti-invention).
    if (!srcCanon || !dstCanon || srcCanon === dstCanon) continue;
    links.push({
      source: srcCanon,
      target: dstCanon,
      relation: "entity_match",
      confidence: "CANDIDATE",
      confidence_score: cand.score,
      source_file: cand.evidence_refs[0] ?? undefined,
    });
  }

  // ── 4. reconciled_as edges (mention → canonical, multi-member only) ───────
  //    For canonicals that were reconciled from > 1 mention, emit one
  //    `reconciled_as` edge per member mention (the mention nodes were
  //    emitted above in step 2). Shows the reconciliation provenance.
  for (const c of state.canonicals) {
    if (c.memberMentionIds.length <= 1) continue;
    for (const mid of c.memberMentionIds) {
      // Only emit when the mention node is present (guards against state drift).
      if (!mentionById.has(mid)) continue;
      links.push({
        source: mid,
        target: c.id,
        relation: "reconciled_as",
        source_file: c.evidenceRefs[0] ?? undefined,
      });
    }
  }

  // ── 5. concerns edges (DesignationEvent → Bylaw, shared evidence ref) ─────
  //    Anti-invention: link only when the two canonicals SHARE at least one
  //    raw S3 evidence ref (same document mentions both). If zero shared refs,
  //    no link — never fabricated.
  const bylaws = state.canonicals.filter((c) => c.type === "Bylaw");
  const events = state.canonicals.filter((c) => c.type === "DesignationEvent");

  for (const ev of events) {
    const evRefs = new Set(ev.evidenceRefs);
    for (const bl of bylaws) {
      const shared = bl.evidenceRefs.some((r) => evRefs.has(r));
      if (!shared) continue;
      // Exactly one edge per (event, bylaw) pair — idempotent.
      links.push({
        source: ev.id,
        target: bl.id,
        relation: "concerns",
        source_file: ev.evidenceRefs[0] ?? undefined,
      });
    }
  }

  // Deduplicate links: same (source, target, relation) → keep first occurrence.
  const seenEdges = new Set<string>();
  const dedupLinks: GraphifyLink[] = [];
  for (const lk of links) {
    const key = `${lk.source}||${lk.target}||${lk.relation}`;
    if (!seenEdges.has(key)) {
      seenEdges.add(key);
      dedupLinks.push(lk);
    }
  }

  return { nodes, links: dedupLinks };
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-export GraphifyGraph for callers that only import from this module
// ─────────────────────────────────────────────────────────────────────────────
export type { GraphifyGraph };
