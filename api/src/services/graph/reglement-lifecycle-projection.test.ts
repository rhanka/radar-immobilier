import { describe, expect, it } from "vitest";
import { ZoningEvent, mockZoningEvent } from "./zoning-event-mock.js";
import { projectZoningEvents, projectEvent, deriveStatut, stableUuid, typeLibelle, typeRelations, type ProjectedNode } from "./reglement-lifecycle-projection.js";
import {
  ZONAGE_FIXTURES,
  SM_2026_511_AVIS,
  SM_2026_511_2E_PROJET,
  SM_2026_511_LIFECYCLE,
  SM_2026_509_PLAN_AVIS,
  SM_2025_492_2E_PROJET,
  SM_2025_492_ADOPTION,
  SM_2025_492_LIFECYCLE,
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

/** LOT 4 — lifecycle_predecessor (n° intersection, D6) + bitemporal (D8) + D5 close-guard. */
describe("predecessor + bitemporal + replaces close-guard — LOT 4", () => {
  it("2e-projet -> adoption: adoption gets lifecycle_predecessor, 2e-projet validTo closes at adoption validFrom", () => {
    const nodes = projectZoningEvents(SM_2025_492_LIFECYCLE);
    const projet = nodes.find((n) => n.kind === "designation-event")!;
    const adoption = nodes.find((n) => n.kind === "bylaw")!;
    expect(
      adoption.node.relations.some(
        (r) => r.relationType === "lifecycle_predecessor" && "nodeId" in r.target && r.target.nodeId === projet.node.id,
      ),
    ).toBe(true);
    expect(projet.node.temporal?.validTo).toBe(adoption.node.temporal?.validFrom);
  });

  it("avis -> 2e-projet: chained by stage order (not emission order), avis validTo closes at successor", () => {
    const nodes = projectZoningEvents(SM_2026_511_LIFECYCLE);
    const avis = nodes.find((n) => n.kind === "designation-event" && n.node.subtype === "avis-motion")!;
    const projet = nodes.find((n) => n.kind === "designation-event" && n.node.subtype === "projet-reglement")!;
    expect(
      projet.node.relations.some((r) => r.relationType === "lifecycle_predecessor" && "nodeId" in r.target && r.target.nodeId === avis.node.id),
    ).toBe(true);
    expect(avis.node.temporal?.validTo).toBe(projet.node.temporal?.validFrom);
  });

  const baseBylaw = mockZoningEvent({ muni: "t", document_type: "adoption", reglement_number: ["100"], bylaw_numero: "100", date_iso: "2020-01-01", libelles_relation: [] });
  const certReplacer = mockZoningEvent({ muni: "t", document_type: "adoption", reglement_number: ["200"], bylaw_numero: "200", date_iso: "2026-05-01", libelles_relation: ["Règlement 200 abroge et remplace le règlement numéro 100"] });
  const uncReplacer = mockZoningEvent({ muni: "t", document_type: "adoption", reglement_number: ["300"], bylaw_numero: "300", date_iso: "2026-05-01", libelles_relation: ["Règlement 300 concernant le règlement numéro 100"] });

  it("a CERTAIN replaces closes the base bylaw's validTo (at the replacing node's validFrom)", () => {
    const nodes = projectZoningEvents([baseBylaw, certReplacer]);
    const base = nodes.find((n) => n.kind === "bylaw" && n.node.numero === "100")!;
    expect(base.node.temporal?.validTo).toBe("2026-05-01");
  });

  // NEGATIVE (mandatory): an uncertain/flagged replaces NEVER closes the base (no silent kill).
  it("an UNCERTAIN/flagged replaces does NOT close the base's validTo", () => {
    const rel = projectZoningEvents([uncReplacer]).find((n) => n.kind === "bylaw" && n.node.numero === "300")!;
    expect(rel.node.relations[0]).toMatchObject({ relationType: "replaces", typingConfidence: "uncertain", flagged: true });
    const nodes = projectZoningEvents([baseBylaw, uncReplacer]);
    const base = nodes.find((n) => n.kind === "bylaw" && n.node.numero === "100")!;
    expect(base.node.temporal?.validTo).toBeNull();
  });
});

/** LOT 5 — #534 fold: typeInstrument passthrough (§10). geo declares it (verbatim-or-null);
 *  immo carries it as-is and NEVER classifies. Orthogonal to document_type (regime). */
describe("typeInstrument passthrough (§10) — LOT 5", () => {
  it("carries the geo-declared instrument family VERBATIM onto the projected node (bylaw + event)", () => {
    expect(projectEvent(COW_1841_52_ADOPTION)?.node.typeInstrument).toBe("zonage");
    expect(projectEvent(SM_2025_492_2E_PROJET)?.node.typeInstrument).toBe("zonage");
  });

  // ANTI-MISLABEL (D9): the plan event IS projected, but carries its DISTINCT instrument
  // (plan-urbanisme) — never silently typed as a zonage change.
  it("plan-mislabel (2026-509) projects with typeInstrument=plan-urbanisme, NOT zonage", () => {
    const p = projectEvent(SM_2026_509_PLAN_AVIS);
    expect(p?.node.typeInstrument).toBe("plan-urbanisme");
    expect(p?.node.typeInstrument).not.toBe("zonage");
  });

  it("an unknown/absent instrument passes through as-is (immo never classifies, §9-tolerant)", () => {
    const unknownInstr = mockZoningEvent({ muni: "x", document_type: "adoption", reglement_number: ["7"], bylaw_numero: "7", typeInstrument: "unknown" });
    expect(projectEvent(unknownInstr)?.node.typeInstrument).toBe("unknown");
    const nullInstr = mockZoningEvent({ muni: "x", document_type: "adoption", reglement_number: ["8"], bylaw_numero: "8" });
    expect(projectEvent(nullInstr)?.node.typeInstrument).toBeNull();
  });
});

/** LOT 6 — en_vigueur 3-states (D7, §2.1) + suspensive gate (B) + abrogation. Synthetic mocks
 *  exercise each derivation branch (real corpus stays in the fixture module). */
describe("en_vigueur 3-states + suspensive gate + abrogation — LOT 6", () => {
  const SESSION = "https://ville.test/pv/2026-06.pdf";
  const atSession = { producer: "mock", source_span: "", source_url: SESSION, as_of_date: null, sha256: "0".repeat(64), retrieved_at: "2026-06-10T00:00:00.000Z" };
  const adoption = (numero: string) =>
    mockZoningEvent({ muni: "v", document_type: "adoption", reglement_number: [numero], bylaw_numero: numero, date_iso: "2026-06-01", provenance: atSession });
  const bylawOf = (nodes: ProjectedNode[], numero: string) => {
    const n = nodes.find((x) => x.kind === "bylaw" && x.node.numero === numero);
    if (n?.kind !== "bylaw") throw new Error(`expected bylaw ${numero}`);
    return n.node;
  };

  it("a served entree_en_vigueur date -> enVigueurProvenance=verbatim + validFrom = the en_vigueur date", () => {
    const env = mockZoningEvent({ muni: "v", document_type: "entree_en_vigueur", reglement_number: ["400"], date_iso: "2026-07-15" });
    const b = bylawOf(projectZoningEvents([adoption("400"), env]), "400");
    expect(b.enVigueurProvenance).toBe("verbatim");
    expect(b.temporal?.validFrom).toBe("2026-07-15");
  });

  it("entree_en_vigueur carrying a stated legal trigger (declencheur) -> derived (source-stated, served date)", () => {
    const env = mockZoningEvent({ muni: "v", document_type: "entree_en_vigueur", reglement_number: ["410"], date_iso: "2026-08-01", declencheur_type: "certificat_mrc", declencheur_date_verbatim: "2026-07-20" });
    const b = bylawOf(projectZoningEvents([adoption("410"), env]), "410");
    expect(b.enVigueurProvenance).toBe("derived");
  });

  // NEGATIVE (mandatory): no served en_vigueur date -> unknown (NEVER a fabricated date / delay table).
  it("adoption with NO entree_en_vigueur -> enVigueurProvenance=unknown (delay-absent, not derived)", () => {
    const b = bylawOf(projectZoningEvents([adoption("420")]), "420");
    expect(b.enVigueurProvenance).toBe("unknown");
  });

  // NEGATIVE (mandatory): an unresolved co-séance suspensive keeps the bylaw OUT of force.
  it("registre-referendaire co-séance (unresolved, document_type=null) -> en_vigueur=UNKNOWN, never in-force", () => {
    const registre = mockZoningEvent({ muni: "v", document_type: null, type: "registre-referendaire", reglement_number: [], date_iso: "2026-06-01", provenance: atSession });
    const b = bylawOf(projectZoningEvents([adoption("430"), registre]), "430");
    expect(b.enVigueurProvenance).toBe("unknown");
  });

  // NEGATIVE (mandatory): abrogation closes the base validTo but is NEVER statut "abandonne".
  it("abrogation closes the abrogated bylaw's validTo at the repeal date (NOT statut abandonne)", () => {
    const base = mockZoningEvent({ muni: "v", document_type: "adoption", reglement_number: ["800"], bylaw_numero: "800", date_iso: "2020-01-01" });
    const abrog = mockZoningEvent({ muni: "v", document_type: "abrogation", reglement_number: ["950"], date_iso: "2026-09-01", libelles_relation: ["Règlement 950 abroge et remplace le règlement numéro 800"] });
    const nodes = projectZoningEvents([base, abrog]);
    expect(bylawOf(nodes, "800").temporal?.validTo).toBe("2026-09-01");
    expect(nodes.every((n) => !("statut" in n.node) || n.node.statut !== "abandonne")).toBe(true);
    expect(deriveStatut(abrog).statut).toBeNull(); // abrogation is not a statut, and NEVER "abandonne"
  });
});
