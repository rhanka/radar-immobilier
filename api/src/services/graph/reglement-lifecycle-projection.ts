import { createHash } from "node:crypto";
import {
  RegulatoryStageKind,
  type RegulatoryStageKindT,
  type OntoDesignationEventT,
  type OntoBylawT,
} from "@radar/domain";
import type { ZoningEventT } from "./zoning-event-mock.js";

/**
 * Règlement-lifecycle projection (in-memory pilot) — LOT 1.b.
 * Pure, deterministic: `projectZoningEvents(events) -> ProjectedNode[]`. No I/O.
 * Consumes the geo-emitted `ZoningEvent` (verbatim) and DERIVES the immo lifecycle
 * (statut / relations / en_vigueur / bitemporal) per frozen contract `5f7ca0a9`.
 * Anti-invention: verbatim-or-unknown; nothing fabricated or inferred.
 *
 * Lot 2 scope: node creation (D3) + statut (D4). Relations (D5), predecessor+bitemporal
 * (D6/D8), and en_vigueur (D7) are layered by later lots onto the nodes created here.
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
    `${((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`
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
  // §9 unknown document_type with no projet/adoption meaning -> null + flagged (never inferred).
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

/** rawRef (§4.6) = the raw-document backing ref. From the emission we carry the source url
 *  (the S3 key is not on the ZoningEvent surface); never empty (schema requires min 1). */
function rawRefOf(ev: ZoningEventT): string {
  return ev.provenance.source_url || ev.url_pdf;
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
      relations: [],
    };
    return { kind: "bylaw", node };
  }

  if (DESIGNATION_DOC_TYPES(ev.document_type)) {
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
      relations: [],
    };
    return { kind: "designation-event", node };
  }

  // entree_en_vigueur / abrogation / content types: no node created in this lot.
  return null;
}

/** Project a batch of ZoningEvents to lifecycle nodes (Lot 2: creation + statut). */
export function projectZoningEvents(events: ZoningEventT[]): ProjectedNode[] {
  return events.map(projectEvent).filter((n): n is ProjectedNode => n !== null);
}
