import { createHash } from "node:crypto";
import {
  RegulatoryStageKind,
  type RegulatoryStageKindT,
  type OntoDesignationEventT,
  type OntoBylawT,
  type OntoRelationT,
} from "@radar/domain";
import type { ZoningEventT } from "./zoning-event-mock.js";

/**
 * Règlement-lifecycle projection (in-memory pilot) — LOT 1.b.
 * Pure, deterministic: `projectZoningEvents(events) -> ProjectedNode[]`. No I/O.
 * Consumes the geo-emitted `ZoningEvent` (verbatim) and DERIVES the immo lifecycle
 * (statut / relations / en_vigueur / bitemporal) per frozen contract `5f7ca0a9`.
 * Anti-invention: verbatim-or-unknown; nothing fabricated or inferred.
 *
 * Layered by lot onto the nodes created here: node+statut (D3/D4), relations (D5),
 * predecessor+bitemporal (D6/D8), typeInstrument passthrough (§10), en_vigueur (D7).
 * typeInstrument is DECLARED-SOURCE by geo and carried VERBATIM (immo never classifies).
 */

export type ProjectedNode =
  | { kind: "designation-event"; node: OntoDesignationEventT }
  | { kind: "bylaw"; node: OntoBylawT };

/** Deterministic UUIDv5-shaped id from a stable seed (event_id) — supports idempotent
 *  re-projection (D10): the same event always maps to the same node id. */
export function stableUuid(seed: string): string {
  const h = createHash("sha256").update(seed).digest("hex");
  // format 32 hex chars as a uuid, stamping version 5 + RFC-4122 variant nibbles
  return (
    `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-` +
    `${((parseInt(h.charAt(16), 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`
  );
}

/**
 * D4 — statut derivation (document_type/type -> RegulatoryStageKind), anti-invention.
 * PRIMARY deterministic path: geo emits premier/second directly via `document_type`
 * (§9-extension). Fallback to `type` for a generic `projet_reglement`. A content
 * document_type (dérogation, etc.) or an unknown value with no projet/adoption meaning
 * -> null (NEVER inferred). `abrogation` is NOT a statut (handled as a replaces relation
 * + validTo closure in a later lot).
 */
// i-arch correction A — a document_type-less event can still carry a KNOWN lifecycle stage or a
// case-marker via `type` (geo emits suspensives/case events as document_type=null, type=<x>).
// STAGE_SUBTYPE members (#535) are BOTH a RegulatoryStageKind (statut) and a DesignationEventSubtype
// (subtype); CASE_MARKER_SUBTYPE members are DesignationEventSubtype only (statut = N-A).
const STAGE_SUBTYPE = (t: string | null): "registre-referendaire" | "consultation-publique" | null =>
  t === "registre-referendaire" || t === "consultation-publique" ? t : null;
const CASE_MARKER_SUBTYPE = (t: string | null): "ppcmoi" | "minor-variance" | null =>
  t === "ppcmoi" ? "ppcmoi" : t === "derogation-mineure" || t === "derogation" || t === "minor-variance" ? "minor-variance" : null;

export function deriveStatut(ev: ZoningEventT): { statut: RegulatoryStageKindT | null; flagged: boolean } {
  const dt = ev.document_type;
  const is1er = (v: string | null) => v === "premier_projet" || v === "1er-projet" || v === "1er_projet";
  const is2e = (v: string | null) => v === "second_projet" || v === "2e-projet" || v === "2e_projet";

  if (dt === "avis_motion") return { statut: "avis-motion", flagged: false };
  if (dt === "adoption") return { statut: "adopte", flagged: false };
  if (dt === "entree_en_vigueur") return { statut: "entree-vigueur", flagged: false };
  if (dt === "abrogation") return { statut: null, flagged: false }; // D4: not a statut
  if (is1er(dt)) return { statut: "1er-projet", flagged: false };
  if (is2e(dt)) return { statut: "2e-projet", flagged: false };
  if (dt === "projet_reglement") {
    if (is1er(ev.type)) return { statut: "1er-projet", flagged: false };
    if (is2e(ev.type)) return { statut: "2e-projet", flagged: false };
    // generic projet with no premier/second qualifier: unknown fine stage -> flag, don't guess.
    return { statut: null, flagged: true };
  }
  // i-arch correction A — no regime from document_type: consult `type`. A procedural stage
  // (registre-referendaire/consultation-publique) is a KNOWN lifecycle stage -> that statut; a
  // case-marker (derogation/ppcmoi) is N-A (no cycle), NOT flagged; else truly-unknown + flagged.
  const stage = STAGE_SUBTYPE(ev.type);
  if (stage) return { statut: stage, flagged: false };
  if (CASE_MARKER_SUBTYPE(ev.type)) return { statut: null, flagged: false };
  // §9 truly-unknown (no document_type regime, no known type) -> null + flagged (never inferred).
  return { statut: null, flagged: true };
}

const DESIGNATION_DOC_TYPES = (dt: string): boolean =>
  dt === "avis_motion" ||
  dt === "projet_reglement" ||
  dt === "premier_projet" ||
  dt === "second_projet" ||
  dt === "1er-projet" ||
  dt === "2e-projet";

function reconOf(ev: ZoningEventT, canonicalId: string) {
  return {
    canonicalId,
    // projected from a geo emission (not a graphify reconciliation patch): no patch id.
    reconStatus: "validated" as const,
    reconPatchId: null,
    knownFrom: ev.provenance.retrieved_at,
    knownTo: null,
  };
}

/** rawRef (§4.6) = the raw-document backing ref (source url; the S3 key is not on the ZoningEvent
 *  surface). MUST be non-empty (OntoNode.rawRef is min 1): both source_url and url_pdf are
 *  z.string().url() so this holds, but we fail LOUD rather than emit a schema-invalid node. */
function rawRefOf(ev: ZoningEventT): string {
  const ref = ev.provenance.source_url || ev.url_pdf;
  if (!ref) throw new Error(`rawRefOf: empty rawRef for event ${ev.event_id} (source_url and url_pdf both empty)`);
  return ref;
}

// ── D5 — relation typing (SAFETY-CRITICAL) ────────────────────────────────────
// geo emits libellés VERBATIM; immo TYPES the relation. replaces (TOTAL, "abroge et
// remplace") vs amends (MODIFICATION, "modifiant", base stays alive) is safety-critical.
// The target n° is the BASE reglement named AFTER the verb, and only when it is stated as
// "règlement (de X)? numéro <n°>" (a bare "le Règlement de zonage" names no base → no target,
// no fabrication). Ambiguity NEVER auto-amends: it falls back to replaces + flagged (a live
// reglement is never silently killed nor a modification fabricated; the flag drives review).
const REGLEMENT_N = "(?:r[eè]glement)(?:\\s+de\\s+\\w+)?\\s+(?:num[ée]ro|n[o°])\\s*([0-9][\\w-]*)";
const REPLACES_RE = new RegExp(`(?:abroge\\w*\\s+et\\s+remplace|abrogeant\\s+et\\s+rempla\\w+|remplace\\w*)\\s+(?:le\\s+)?${REGLEMENT_N}`, "i");
const AMENDS_RE = new RegExp(`(?:modifiant|modification\\s+au|modifie|amend\\w+)\\s+(?:le\\s+)?${REGLEMENT_N}`, "i");
const ANY_REGLEMENT_RE = new RegExp(REGLEMENT_N, "i");

/** Type a single verbatim libellé into a discriminated relation, or null if no base n° is named. */
export function typeLibelle(libelle: string): OntoRelationT | null {
  const repN = libelle.match(REPLACES_RE)?.[1];
  if (repN) return { relationType: "replaces", target: { reglementNumero: repN }, fromLibelle: libelle, typingConfidence: "certain", flagged: false };
  const amN = libelle.match(AMENDS_RE)?.[1];
  if (amN) return { relationType: "amends", target: { reglementNumero: amN }, fromLibelle: libelle, typingConfidence: "certain", flagged: false };
  // A base n° is named but with no certain verb -> AMBIGUOUS: replaces + flagged (NEVER auto-amends).
  const anyN = libelle.match(ANY_REGLEMENT_RE)?.[1];
  if (anyN) return { relationType: "replaces", target: { reglementNumero: anyN }, fromLibelle: libelle, typingConfidence: "uncertain", flagged: true };
  return null;
}

/** Type all of an event's verbatim libellés into α-relations (D5). */
export function typeRelations(ev: ZoningEventT): OntoRelationT[] {
  return ev.libelles_relation.map(typeLibelle).filter((r): r is OntoRelationT => r !== null);
}

/**
 * Lot 2 — create the lifecycle node for an event and stamp statut + cible (avis-only).
 * Relations/temporal/en_vigueur default empty/null here; later lots enrich them.
 * `entree_en_vigueur`/`abrogation` do not create a node here (they update/relate an
 * existing Bylaw — handled in the en_vigueur lot); return null for those.
 */
export function projectEvent(ev: ZoningEventT): ProjectedNode | null {
  const { statut } = deriveStatut(ev);
  const cible = ev.document_type === "avis_motion" ? ev.cible_reglement_numero : null;

  if (ev.document_type === "adoption") {
    const numero = ev.bylaw_numero ?? ev.reglement_number.find((n): n is string => n != null) ?? "";
    const node: OntoBylawT = {
      id: stableUuid(ev.event_id),
      citySlug: ev.muni,
      numero,
      titre: null,
      amendsBylawId: null,
      rawRef: rawRefOf(ev),
      recon: reconOf(ev, `bylaw::${ev.muni}::${numero || ev.event_id}`),
      evidence: [],
      temporal: null,
      enVigueurProvenance: null,
      relations: typeRelations(ev),
      typeInstrument: ev.typeInstrument, // §10 — verbatim passthrough (immo never classifies)
    };
    return { kind: "bylaw", node };
  }

  if (DESIGNATION_DOC_TYPES(ev.document_type ?? "")) {
    const subtype = ev.document_type === "avis_motion" ? "avis-motion" : "projet-reglement";
    const node: OntoDesignationEventT = {
      id: stableUuid(ev.event_id),
      citySlug: ev.muni,
      subtype,
      occurredOn: ev.date_iso,
      rawRef: rawRefOf(ev),
      recon: reconOf(ev, `event::${ev.muni}::${ev.event_id}`),
      evidence: [],
      statut,
      cibleReglementNumero: cible,
      temporal: null,
      relations: typeRelations(ev),
      typeInstrument: ev.typeInstrument, // §10 — verbatim passthrough (immo never classifies)
    };
    return { kind: "designation-event", node };
  }

  // i-arch correction A — a document_type-less event that still carries a regulatory signal via
  // `type` SURVIVES as a DesignationEvent (never a silent drop = converse anti-invention):
  //  · a procedural stage (registre-referendaire/consultation-publique) -> subtype=statut=the stage;
  //  · a case-marker (ppcmoi/derogation) -> subtype ppcmoi/minor-variance, statut N-A (null).
  const stageSub = STAGE_SUBTYPE(ev.type);
  const caseSub = CASE_MARKER_SUBTYPE(ev.type);
  if (stageSub || caseSub) {
    const node: OntoDesignationEventT = {
      id: stableUuid(ev.event_id),
      citySlug: ev.muni,
      subtype: (stageSub ?? caseSub)!, // literal unions, both ⊂ DesignationEventSubtype
      occurredOn: ev.date_iso,
      rawRef: rawRefOf(ev),
      recon: reconOf(ev, `event::${ev.muni}::${ev.event_id}`),
      evidence: [],
      statut, // stage -> the stage (rule A); case-marker -> null (N-A)
      cibleReglementNumero: null,
      temporal: null,
      relations: typeRelations(ev),
      typeInstrument: ev.typeInstrument, // §10 — verbatim passthrough
    };
    return { kind: "designation-event", node };
  }

  // entree_en_vigueur / abrogation / truly-unknown content: no node created.
  return null;
}

// ── D6 lifecycle_predecessor (n° intersection) + D8 bitemporal + D5 close-guard + D7 en_vigueur ────
const PREMIER = new Set(["premier_projet", "1er-projet", "1er_projet"]);
const SECOND = new Set(["second_projet", "2e-projet", "2e_projet"]);

/** Legal stage order for predecessor chaining (§5): avis < projet(1er<2e) < adopté < en_vigueur. */
function stageOrder(ev: ZoningEventT): number {
  const dt = ev.document_type ?? "";
  if (dt === "avis_motion") return 0;
  if (PREMIER.has(dt) || (dt === "projet_reglement" && PREMIER.has(ev.type ?? ""))) return 1;
  if (SECOND.has(dt) || (dt === "projet_reglement" && SECOND.has(ev.type ?? ""))) return 2;
  if (dt === "projet_reglement") return 1;
  if (dt === "adoption") return 3;
  if (dt === "entree_en_vigueur") return 4;
  return 99;
}

/** Lineage keys an event belongs to. avis: the announced cible; projet/adoption/en_vigueur:
 *  the reglement_number LIST (refonte = several -> the event joins each -> §5 intersection). */
function lineageNumeros(ev: ZoningEventT): string[] {
  if (ev.document_type === "avis_motion") return ev.cible_reglement_numero ? [ev.cible_reglement_numero] : [];
  return ev.reglement_number.filter((n): n is string => n != null);
}

function predecessorRelation(predId: string): OntoRelationT {
  return { relationType: "lifecycle_predecessor", target: { nodeId: predId }, fromLibelle: null, typingConfidence: "certain", flagged: false };
}

/**
 * Project a batch of ZoningEvents to lifecycle nodes: per-event creation/typing (Lot 2/3)
 * then a correlation pass — lifecycle_predecessor by n° intersection (D6), bitemporal
 * validFrom/validTo (D8), en_vigueur 3-states (D7/§2.1), the D5 close-guard, abrogation closure,
 * and Rule-B séance attachment. entree_en_vigueur/abrogation update/close existing bylaws (no own node).
 */
export function projectZoningEvents(events: ZoningEventT[]): ProjectedNode[] {
  const projected = events
    .map((ev) => ({ ev, p: projectEvent(ev) }))
    .filter((x): x is { ev: ZoningEventT; p: ProjectedNode } => x.p !== null);

  // D8 — validFrom is the VERBATIM date_iso; validTo opens null, closed by a successor below.
  // No date -> no temporal (verbatim-or-unknown; a validFrom is never fabricated).
  for (const { ev, p } of projected)
    if (ev.date_iso)
      p.node.temporal = { validFrom: ev.date_iso, validTo: null, knownFrom: ev.provenance.retrieved_at, knownTo: null };

  // D7 — en_vigueur 3-states (§2.1). Per Bylaw, enVigueurProvenance is derived ONLY from a SERVED
  // entree_en_vigueur: verbatim (date served directly) | derived (the source states the legal
  // trigger) | unknown. In-force is asserted ONLY by a served date — a served entree_en_vigueur
  // IMPLIES any cycle suspensive (registre-referendaire) already resolved (the bylaw came into
  // force), so env wins; else unknown. NEVER in-force without a served date; NO fabricated date,
  // NO hardcoded delay table. (A suspensive still surfaces as a Lot-7 node + Rule-B séance edge.)
  for (const { ev, p } of projected) {
    if (p.kind !== "bylaw") continue;
    const numeros = lineageNumeros(ev);
    const env = events.find(
      (e) => e.document_type === "entree_en_vigueur" && !!e.date_iso &&
        e.reglement_number.some((n) => n != null && numeros.includes(n)),
    );
    p.node.enVigueurProvenance = env
      ? env.declencheur_type ? "derived" : "verbatim" // served date; derived iff the source states the legal trigger
      : "unknown"; // no served en_vigueur date -> never fabricated (no delay table)
    if (env?.date_iso && p.node.temporal)
      p.node.temporal = { ...p.node.temporal, validFrom: env.date_iso }; // in-force date = the served en_vigueur date
  }

  // D6 — within each lineage, chain by stage order; close each predecessor's validTo at the
  // successor's validFrom. An event in several lineages (refonte) links in each (intersection).
  const byNumero = new Map<string, { ev: ZoningEventT; p: ProjectedNode }[]>();
  for (const item of projected)
    for (const n of lineageNumeros(item.ev)) {
      const arr = byNumero.get(n) ?? [];
      arr.push(item);
      byNumero.set(n, arr);
    }
  const linkedEdges = new Set<string>();
  for (const arr of byNumero.values()) {
    const chain = [...arr].sort(
      (a, b) => stageOrder(a.ev) - stageOrder(b.ev) || (a.ev.date_iso ?? "").localeCompare(b.ev.date_iso ?? ""),
    );
    for (let i = 1; i < chain.length; i++) {
      const predItem = chain[i - 1], succItem = chain[i];
      if (!predItem || !succItem) continue;
      const pred = predItem.p, succ = succItem.p;
      if (pred.node.id === succ.node.id) continue;
      const edge = `${succ.node.id}<-${pred.node.id}`;
      if (!linkedEdges.has(edge)) {
        succ.node.relations.push(predecessorRelation(pred.node.id));
        linkedEdges.add(edge);
      }
      if (pred.node.temporal && succ.node.temporal?.validFrom)
        pred.node.temporal = { ...pred.node.temporal, validTo: succ.node.temporal.validFrom };
    }
  }

  // D5 close-guard — ONLY a CERTAIN replaces closes the target base's validTo. An uncertain/
  // flagged replaces NEVER closes it (a live reglement is never silently killed; flag -> review).
  const bylawByNumero = new Map<string, ProjectedNode>();
  for (const { p } of projected) if (p.kind === "bylaw" && p.node.numero) bylawByNumero.set(p.node.numero, p);
  for (const { p } of projected)
    for (const r of p.node.relations)
      if (r.relationType === "replaces" && r.typingConfidence === "certain" && "reglementNumero" in r.target) {
        const base = bylawByNumero.get(r.target.reglementNumero);
        if (base?.node.temporal && p.node.temporal?.validFrom)
          base.node.temporal = { ...base.node.temporal, validTo: p.node.temporal.validFrom };
      }

  // D7 — abrogation closes the abrogated bylaw's validTo at the repeal date. It is a REPLACES
  // relation (repealer -> repealed), NEVER a statut "abandonne" (a repealed live bylaw is not an
  // abandoned project). An abrogation event creates no node; it closes the named base here.
  for (const ev of events)
    if (ev.document_type === "abrogation" && ev.date_iso)
      for (const r of typeRelations(ev))
        if (r.relationType === "replaces" && "reglementNumero" in r.target) {
          const base = bylawByNumero.get(r.target.reglementNumero);
          if (base?.node.temporal) base.node.temporal = { ...base.node.temporal, validTo: ev.date_iso };
        }

  // Rule B (i-arch) — a procedural-stage node (registre-referendaire/consultation-publique) carries
  // NO n°; attach it to its bylaw by SHARED rawRef (same séance), uncertain+flagged (séance-context,
  // not n°-verified). Exactly 1 co-séance bylaw -> link; several -> UNKNOWN attachment (never guess
  // which); 0 -> float (kept verbatim, unattached). Never invent a n°.
  for (const s of projected) {
    if (s.p.kind !== "designation-event" || STAGE_SUBTYPE(s.ev.type) === null) continue;
    const cands = projected.filter((x) => x.p.kind === "bylaw" && rawRefOf(x.ev) === rawRefOf(s.ev));
    const bylaw = cands.length === 1 ? cands[0] : undefined;
    if (bylaw)
      bylaw.p.node.relations.push({ relationType: "lifecycle_predecessor", target: { nodeId: s.p.node.id }, fromLibelle: null, typingConfidence: "uncertain", flagged: true });
  }

  return projected.map((x) => x.p);
}
