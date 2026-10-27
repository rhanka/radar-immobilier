import { beforeEach, describe, expect, it, vi } from "vitest";
import { prospectMarksRoute } from "./prospect-marks.js";
import { lotCutoverState, lotLegacyFence } from "../db/schema.js";
import { upsertMark } from "../services/prospect/marks-service.js";
import { publish } from "../services/chat/stream-bus.js";
vi.mock("../services/chat/stream-bus.js", () => ({ publish: vi.fn() }));
vi.mock("../services/prospect/marks-service.js", () => ({
  upsertMark: vi.fn(), addNote: vi.fn(), editNote: vi.fn(), softDeleteNote: vi.fn(),
  listNotes: vi.fn(), batchUpsertMarks: vi.fn(), getActiveMarksForLot: vi.fn(),
  getActiveMarksForZone: vi.fn(), getNotesForLot: vi.fn(),
}));
const db = {
  select: vi.fn().mockReturnValue({ from: vi.fn().mockImplementation((table) =>
    table === lotCutoverState ? Promise.resolve([]) : table === lotLegacyFence
      ? Promise.resolve([{ singleton: true, enabled: false }]) : Promise.resolve([]),
  ) }), insert: vi.fn(), update: vi.fn(), transaction: vi.fn(),
} as unknown as Parameters<typeof prospectMarksRoute>[0]["db"];
describe("D6 raw JSON HTTP number rejection", () => {
  beforeEach(() => vi.clearAllMocks());
  for (const lexeme of ["1e400", "-1e400"]) it(`rejects ${lexeme} before any write`, async () => {
    const response = await prospectMarksRoute({ db }).request("/api/v1/prospects/marks", {
      method: "POST", headers: { "content-type": "application/json" },
      body: `{"lotVersionId":"aaaaaaaa-aaaa-0000-0000-aaaaaaaaaaaa","noLot":"LOT-A","citySlug":"ville-test","dimension":"marche","statut":"en_vente","prixDemande":${lexeme},"authorId":"22222222-2222-4222-8222-222222222222"}`,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid request", details: [
      { code: "not_finite", path: ["prixDemande"], message: "Number must be finite" },
    ] });
    expect(upsertMark).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
