import { beforeEach, describe, expect, it, vi } from "vitest";
import { prospectMarksRoute } from "./prospect-marks.js";
import { lotCutoverState, lotLegacyFence } from "../db/schema.js";

vi.mock("../services/chat/stream-bus.js", () => ({
  publish: vi.fn().mockResolvedValue({ streamId: "x", type: "t", sequence: 0, data: {} }),
}));
vi.mock("../services/prospect/marks-service.js", () => ({
  upsertMark: vi.fn(),
  addNote: vi.fn(),
  editNote: vi.fn(),
  softDeleteNote: vi.fn(),
  listNotes: vi.fn().mockResolvedValue([]),
  batchUpsertMarks: vi.fn().mockResolvedValue({ created: 1, lots: [] }),
  getActiveMarksForLot: vi.fn().mockResolvedValue([]),
  getActiveMarksForZone: vi.fn().mockResolvedValue([]),
  getNotesForLot: vi.fn().mockResolvedValue([]),
}));

const mockDb = {
  select: vi.fn().mockReturnValue({
    from: vi.fn().mockImplementation((table: unknown) =>
      table === lotCutoverState
        ? Promise.resolve([])
        : table === lotLegacyFence
          ? Promise.resolve([{ singleton: true, enabled: false }])
          : { where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) }),
  }),
  insert: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
} as unknown as Parameters<typeof prospectMarksRoute>[0]["db"];

function makeApp() {
  return prospectMarksRoute({ db: mockDb });
}

const LOT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AUTHOR_ID = "22222222-2222-4222-8222-222222222222";

/**
 * L3b characterization: R1-A (bad key + bad value) and R1-B (__proto__ key).
 * Raw JSON text keeps __proto__ as an own data property after JSON.parse.
 */
describe("l3b batch lotMeta R1-A and R1-B raw JSON", () => {
  beforeEach(() => vi.clearAllMocks());

  it("R1-A rejects bad key and both bad values with three diagnostics in order", async () => {
    const app = makeApp();
    const raw = JSON.stringify({
      lotVersionIds: [LOT_ID],
      lotMeta: { bad: { noLot: "", citySlug: "" } },
      dimension: "pipeline",
      statut: "favori",
      authorId: AUTHOR_ID,
    });
    const res = await app.request("/api/v1/prospects/marks/batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid request");
    expect(Array.isArray(body.details)).toBe(true);
    expect(body.details.length).toBe(3);
    expect(body.details[0].path).toEqual(["lotMeta", "bad"]);
    expect(body.details[1].path).toEqual(["lotMeta", "bad", "noLot"]);
    expect(body.details[2].path).toEqual(["lotMeta", "bad", "citySlug"]);
    const { batchUpsertMarks, upsertMark } = await import("../services/prospect/marks-service.js");
    expect(batchUpsertMarks).not.toHaveBeenCalled();
    expect(upsertMark).not.toHaveBeenCalled();
    const { publish } = await import("../services/chat/stream-bus.js");
    expect(publish).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("R1-B rejects a __proto__ key sent as raw JSON text", async () => {
    const app = makeApp();
    const raw =
      `{"lotVersionIds":["${LOT_ID}"],` +
      `"lotMeta":{"__proto__":{"noLot":"LOT-A","citySlug":"ville-test"}},` +
      `"dimension":"pipeline","statut":"favori","authorId":"${AUTHOR_ID}"}`;
    const parsed = JSON.parse(raw) as Record<string, Record<string, unknown>>;
    expect(Object.prototype.hasOwnProperty.call(parsed["lotMeta"], "__proto__")).toBe(true);
    const res = await app.request("/api/v1/prospects/marks/batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid request");
    const paths = (body.details as { path: (string | number)[] }[]).map((entry) =>
      entry.path.join("."),
    );
    expect(paths.some((path) => path.includes("__proto__"))).toBe(true);
    const { batchUpsertMarks } = await import("../services/prospect/marks-service.js");
    expect(batchUpsertMarks).not.toHaveBeenCalled();
    const { publish } = await import("../services/chat/stream-bus.js");
    expect(publish).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("accepts a valid batch witness with 201", async () => {
    const app = makeApp();
    const res = await app.request("/api/v1/prospects/marks/batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        lotVersionIds: [LOT_ID],
        lotMeta: { [LOT_ID]: { noLot: "LOT-A", citySlug: "ville-test" } },
        dimension: "pipeline",
        statut: "favori",
        authorId: AUTHOR_ID,
      }),
    });
    expect(res.status).toBe(201);
  });
});
