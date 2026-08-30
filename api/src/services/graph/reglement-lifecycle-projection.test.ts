import { describe, expect, it } from "vitest";
import { ZoningEvent, mockZoningEvent } from "./zoning-event-mock.js";
import { projectZoningEvents, projectEvent, deriveStatut, stableUuid, typeLibelle, typeRelations } from "./reglement-lifecycle-projection.js";
import {
  ZONAGE_FIXTURES,
  SM_2026_511_AVIS,
  SM_2026_511_2E_PROJET,
  SM_2026_509_PLAN_AVIS,
  SM_2025_492_2E_PROJET,
  SM_2025_492_ADOPTION,
  COW_1841_52_ADOPTION,
  CAN_5000_076_SECOND_PROJET,
} from "./reglement-lifecycle-projection.fixture.js";

/**
 * LOT 1 — mock input contract conformance.
 * The fixtures are built through `mockZoningEvent` (which parses through the schema), so this
 * suite pins the emitted-shape invariants that the later derivation lots depend on.
 */
describe("ZoningEvent contract (mock input) — LOT 1", () => {
  it("all in-scope ZONAGE fixtures parse against the emitted shape", () => {
    for (const ev of ZONAGE_FIXTURES) expect(() => ZoningEvent.parse(ev)).not.toThrow();
  });

  it("avis_motion carries cible = announced n° and an EMPTY reglement_number (§1)", () => {
    expect(SM_2026_511_AVIS.document_type).toBe("avis_motion");
    expect(SM_2026_511_AVIS.cible_reglement_numero).toBe("2026-511");
    expect(SM_2026_511_AVIS.reglement_number).toEqual([]);
  });

  it("adoption/projet carry cible=null and the base n° lives ONLY in libelles_relation (§1/§4)", () => {
    for (const ev of [SM_2025_492_ADOPTION, COW_1841_52_ADOPTION, CAN_5000_076_SECOND_PROJET]) {
      expect(ev.cible_reglement_numero).toBeNull();
      expect(ev.reglement_number.length).toBeGreaterThan(0);
      expect(ev.libelles_relation.join(" ")).toMatch(/modifi/i);
    }
  });

  it("cible-avis-only guard REJECTS a non-avis event with a non-null cible (mis-correlation barrier)", () => {
    expect(() =>
      mockZoningEvent({
        muni: "x",
        document_type: "adoption",
        reglement_number: ["1"],
        // runtime-invalid (type allows a nullable string; the refine rejects it on a non-avis type):
        // the base n° must NOT be placed in cible on an adoption.
        cible_reglement_numero: "2019-342",
      }),
    ).toThrow(/avis_motion-only/);
  });

  it("§9 tolerates an unknown document_type (e.g. second_projet) without crashing", () => {
    expect(CAN_5000_076_SECOND_PROJET.document_type).toBe("second_projet");
    expect(() => ZoningEvent.parse(CAN_5000_076_SECOND_PROJET)).not.toThrow();
  });

  it("the plan-mislabel fixture (2026-509) targets the PLAN (2019-341), NOT the zonage", () => {
    // guardrail for the D9 anti-invention test in a later lot: this event must never be
    // projected as a zonage change.
    expect(SM_2026_509_PLAN_AVIS.libelles_relation.join(" ")).toMatch(/plan d'urbanisme/i);
    expect(SM_2026_509_PLAN_AVIS.libelles_relation.join(" ")).not.toMatch(/règlement de zonage/i);
  });
});

/** LOT 2 — node creation (D3) + statut derivation (D4). */
describe("projection: node creation + statut — LOT 2", () => {
  it("avis_motion -> DesignationEvent(avis-motion), statut=avis-motion, cible carried", () => {
    const p = projectEvent(SM_2026_511_AVIS);
    expect(p?.kind).toBe("designation-event");
    if (p?.kind !== "designation-event") throw new Error("expected designation-event");
    expect(p.node.subtype).toBe("avis-motion");
    expect(p.node.statut).toBe("avis-motion");
    expect(p.node.cibleReglementNumero).toBe("2026-511");
  });

  it("projet_reglement + type=second_projet -> DesignationEvent(projet-reglement), statut=2e-projet, cible=null", () => {
    const p = projectEvent(SM_2025_492_2E_PROJET);
    if (p?.kind !== "designation-event") throw new Error("expected designation-event");
    expect(p.node.subtype).toBe("projet-reglement");
    expect(p.node.statut).toBe("2e-projet");
    expect(p.node.cibleReglementNumero).toBeNull(); // cible is avis-only
  });

  it("§9 document_type=second_projet (emitted directly) -> statut=2e-projet (PRIMARY deterministic path)", () => {
    expect(deriveStatut(CAN_5000_076_SECOND_PROJET)).toEqual({ statut: "2e-projet", flagged: false });
    const p = projectEvent(CAN_5000_076_SECOND_PROJET);
    if (p?.kind !== "designation-event") throw new Error("expected designation-event");
    expect(p.node.statut).toBe("2e-projet");
  });

  it("adoption -> Bylaw with numero (no statut field on a Bylaw)", () => {
    const p = projectEvent(COW_1841_52_ADOPTION);
    expect(p?.kind).toBe("bylaw");
    if (p?.kind !== "bylaw") throw new Error("expected bylaw");
    expect(p.node.numero).toBe("1841-52-2026");
    expect(p.node).not.toHaveProperty("statut");
  });

  it("a generic projet_reglement with no premier/second qualifier -> statut null + flagged (never guessed)", () => {
    const ev = mockZoningEvent({ muni: "x", document_type: "projet_reglement", reglement_number: ["9"] });
    expect(deriveStatut(ev)).toEqual({ statut: null, flagged: true });
  });

  it("a content document_type (dérogation) creates NO lifecycle node (out of reglement-lifecycle)", () => {
    const ev = mockZoningEvent({ muni: "x", document_type: "derogation_mineure", reglement_number: [] });
    expect(deriveStatut(ev).statut).toBeNull();
    expect(projectEvent(ev)).toBeNull();
  });

  it("node id is deterministic from event_id (idempotent re-projection, D10)", () => {
    const a = projectEvent(SM_2025_492_ADOPTION);
    const b = projectEvent(SM_2025_492_ADOPTION);
    expect(a?.node.id).toBe(b?.node.id);
    expect(a?.node.id).toBe(stableUuid(SM_2025_492_ADOPTION.event_id));
    expect(a?.node.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("projectZoningEvents keeps all in-scope ZONAGE fixtures (2 avis/projet + adoption + second_projet)", () => {
    const nodes = projectZoningEvents(ZONAGE_FIXTURES);
    expect(nodes.length).toBe(ZONAGE_FIXTURES.length);
    expect(nodes.filter((n) => n.kind === "bylaw").length).toBe(2); // SM 2025-492 adoption + COW adoption
  });
});

/** LOT 3 — relation typing (D5, safety-critical). */
describe("relation typing (libellé verbatim -> replaces/amends) — LOT 3", () => {
  it("'modifiant le Règlement de zonage numéro X' -> amends(X) certain, base n° from the libellé", () => {
    const r = typeLibelle("Adoption du Règlement numéro 2025-492 modifiant le Règlement de zonage numéro 2019-342");
    expect(r).not.toBeNull();
    expect(r?.relationType).toBe("amends");
    expect(r?.target).toEqual({ reglementNumero: "2019-342" }); // the BASE, not the subject 2025-492
    expect(r?.typingConfidence).toBe("certain");
    expect(r?.flagged).toBe(false);
  });

  it("'abroge et remplace le règlement numéro X' -> replaces(X) certain", () => {
    const r = typeLibelle("QUE le règlement 900 abroge et remplace le règlement numéro 764");
    expect(r?.relationType).toBe("replaces");
    expect(r?.target).toEqual({ reglementNumero: "764" });
    expect(r?.typingConfidence).toBe("certain");
  });

  // NEGATIVE (mandatory): an ambiguous libellé is NEVER auto-typed amends.
  it("ambiguous libellé (base n° named, no certain verb) -> replaces + uncertain + FLAGGED, NEVER amends", () => {
    const r = typeLibelle("Résolution concernant le règlement numéro 150-49");
    expect(r?.relationType).toBe("replaces"); // fallback label, not amends
    expect(r?.relationType).not.toBe("amends");
    expect(r?.typingConfidence).toBe("uncertain");
    expect(r?.flagged).toBe(true);
  });

  // ANTI-INVENTION: a bare "le Règlement de zonage" (no base n°) yields NO fabricated target.
  it("no base n° named (candiac zone-creation) -> NO relation (never fabricate a target)", () => {
    expect(typeLibelle("Règlement 5000-076 modifiant le Règlement de zonage afin de créer la zone P-447")).toBeNull();
    expect(typeRelations(CAN_5000_076_SECOND_PROJET)).toEqual([]);
  });

  it("typed relations are wired onto the projected node", () => {
    const p = projectEvent(COW_1841_52_ADOPTION);
    if (p?.kind !== "bylaw") throw new Error("expected bylaw");
    expect(p.node.relations).toHaveLength(1);
    expect(p.node.relations[0]).toMatchObject({ relationType: "amends", target: { reglementNumero: "1841" } });
  });
});
