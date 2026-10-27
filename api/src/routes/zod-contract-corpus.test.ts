import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contractSafeParse } from "@radar/domain";
import { createMarkSchema, createNoteSchema, editNoteSchema, batchMarkSchema, listNotesQuerySchema } from "./prospect-marks.js";
import { StatusBody } from "./admin.js";
import { addItemSchema } from "./backlog.js";
import { createMessageSchema } from "./chat.js";
import { decisionSchema } from "./h2a.js";
import { CiblagePlanInput, CiblagePlanPatch, ScrapeStatus } from "@radar/domain";
import { ontologyPatchSchema } from "../services/exploitation/patches.js";

const mark = { lotVersionId: "aaaaaaaa-aaaa-0000-0000-aaaaaaaaaaaa", dimension: "pipeline", statut: "favori" };
const cases = [
  ["mark-missing", createMarkSchema, {}],
  ["mark-discriminant", createMarkSchema, { dimension: "other" }],
  ["mark-guid", createMarkSchema, mark],
  ["mark-fields", createMarkSchema, { ...mark, lotVersionId: "bad", statut: "other", mode: false }],
  ["market-positive", createMarkSchema, { ...mark, dimension: "marche", statut: "en_vente", prixDemande: 0 }],
  ["note-missing", createNoteSchema, {}],
  ["note-fields", createNoteSchema, { target_type: "signal", signal_id: "bad", content: false }],
  ["note-edit", editNoteSchema, { content: "", authorId: 42 }],
  ["note-query", listNotesQuerySchema, { target_type: "unknown" }],
  ["batch-missing", batchMarkSchema, {}],
  ["batch-record", batchMarkSchema, { lotVersionIds: [mark.lotVersionId], lotMeta: { bad: { noLot: "", citySlug: "" } }, dimension: "pipeline", statut: "favori" }],
  ["batch-simultaneous", batchMarkSchema, { lotVersionIds: [], lotMeta: { bad: null }, dimension: false, statut: "bad", mode: "bad" }],
  ["admin-missing", StatusBody, {}],
  ["admin-fields", StatusBody, { status: "bad", reason: " " }],
  ["backlog-missing", addItemSchema, {}],
  ["backlog-fields", addItemSchema, { titre: " ", description: 42 }],
  ["chat-missing", createMessageSchema, {}],
  ["chat-fields", createMessageSchema, { providerId: false, messages: [{ role: "bad", content: 42 }] }],
  ["h2a-fields", decisionSchema, { kind: "bad", entity: null }],
  ["ciblage-create", CiblagePlanInput, {}],
  ["ciblage-patch", CiblagePlanPatch, { extra: true }],
  ["scrape-status", ScrapeStatus, { status: "bad", source: "bad" }],
  ["ontology-discriminant", ontologyPatchSchema, { op: "unknown" }],
  ["ontology-fields", ontologyPatchSchema, { op: "set_status", canonicalId: "", from: "wrong", to: null }],
] as const;
const fixture = new URL("../../tests/fixtures/zod3-contracts.json", import.meta.url);
const actual = Object.fromEntries(cases.map(([name, schema, input]) => {
  const parsed = contractSafeParse(schema, input);
  return [name, parsed.success ? { data: parsed.data } : { details: parsed.error.issues, detail: parsed.error.format() }];
}));
if (process.env.ZOD_CAPTURE === "1") writeFileSync(fixture,
  "{\n" + Object.entries(actual).map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(",\n") + "\n}\n");
const expected = JSON.parse(readFileSync(fixture, "utf8")) as Record<string, unknown>;
describe("Zod 3 baseline contracts from actual API schemas (8156568a)", () => {
  for (const [name] of cases) it(name, () => {
    expect(JSON.parse(JSON.stringify(actual[name]))).toEqual(expected[name]);
    expect(JSON.stringify(actual[name])).toBe(JSON.stringify(expected[name]));
  });
  it("keeps historic non-RFC identifiers and strips extras", () => {
    expect(createMarkSchema.parse({ ...mark, noLot: "LOT-A", citySlug: "ville-test", extra: true }))
      .toEqual({ ...mark, noLot: "LOT-A", citySlug: "ville-test", mode: "real" });
  });
});
