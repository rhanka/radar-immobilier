import { describe, expect, it } from "vitest";
import { ZoningEvent, mockZoningEvent } from "./zoning-event-mock.js";
import {
  ZONAGE_FIXTURES,
  SM_2026_511_AVIS,
  SM_2026_509_PLAN_AVIS,
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
