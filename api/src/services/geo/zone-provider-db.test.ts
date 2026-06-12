/**
 * Tests unitaires du ZoneVersionProvider DB.
 *
 * Pas d'accès Postgres réel — DB mockée avec vi.fn().
 * Vérifie :
 *   - zones peuplées → index chargé
 *   - zones absentes → provider retourne null honnêtement
 *   - makeIndexedZoneProvider avec résolution noLot → codeAffiche
 */
import { describe, expect, it, vi } from "vitest";
import {
  makeCityZoneIndex,
  makeIndexedZoneProvider,
  makeDbZoneVersionProvider,
} from "./zone-provider-db.js";

// ─── Helpers mock DB ──────────────────────────────────────────────────────────

/** Zone row minimal retourné par la DB (comme inféré par drizzle). */
type MockZoneRow = {
  codeAffiche: string;
  kind: string;
  evidence: unknown;
};

/**
 * Crée un mock de Database (seul `select/from/where` est imité).
 * Drizzle chaîne les appels → on simule avec un objet chainable.
 */
function makeMockDb(rows: MockZoneRow[]) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(rows),
    select: vi.fn(),
  };
  chain.select.mockReturnValue(chain);
  return chain as unknown as Parameters<typeof makeCityZoneIndex>[0];
}

// ─── Tests makeCityZoneIndex ──────────────────────────────────────────────────

describe("makeCityZoneIndex — zones peuplées", () => {
  it("charge les zones dans l'index byCode", async () => {
    const db = makeMockDb([
      { codeAffiche: "H-609-4", kind: "H", evidence: [] },
      { codeAffiche: "C-201", kind: "C", evidence: [] },
    ]);

    const index = await makeCityZoneIndex(db, "salaberry-de-valleyfield");

    expect(index.citySlug).toBe("salaberry-de-valleyfield");
    expect(index.totalZones).toBe(2);
    expect(index.byCode.has("H-609-4")).toBe(true);
    expect(index.byCode.has("C-201")).toBe(true);
  });

  it("ZoneVersionInput : kind correct, densiteLogHa=null (non-disponible honnête)", async () => {
    const db = makeMockDb([
      { codeAffiche: "H-609-4", kind: "H", evidence: [] },
    ]);

    const index = await makeCityZoneIndex(db, "salaberry-de-valleyfield");
    const zv = index.byCode.get("H-609-4")!;

    expect(zv.kind).toBe("H");
    expect(zv.densiteLogHa).toBeNull();
    expect(zv.usages).toEqual([]);
  });

  it("dupliqué codeAffiche : garde le premier (ordre stable)", async () => {
    const db = makeMockDb([
      { codeAffiche: "H-609-4", kind: "H", evidence: [] },
      { codeAffiche: "H-609-4", kind: "C", evidence: [] }, // doublon
    ]);

    const index = await makeCityZoneIndex(db, "salaberry-de-valleyfield");
    expect(index.totalZones).toBe(2);
    expect(index.byCode.size).toBe(1);
    expect(index.byCode.get("H-609-4")?.kind).toBe("H"); // premier gardé
  });
});

describe("makeCityZoneIndex — zones absentes", () => {
  it("ville sans zones → index vide, totalZones=0", async () => {
    const db = makeMockDb([]);

    const index = await makeCityZoneIndex(db, "ville-sans-zones");

    expect(index.totalZones).toBe(0);
    expect(index.byCode.size).toBe(0);
  });
});

// ─── Tests makeDbZoneVersionProvider ─────────────────────────────────────────

describe("makeDbZoneVersionProvider — zones absentes → provider null honnête", () => {
  it("retourne null pour tout lot quand la ville n'a pas de zones peuplées", async () => {
    const db = makeMockDb([]);
    const provider = await makeDbZoneVersionProvider(db, "ville-sans-zones");

    const result = provider("4193751", "ville-sans-zones");
    expect(result).toBeNull();
  });
});

describe("makeDbZoneVersionProvider — zones peuplées mais lot_zone_resolution absente", () => {
  it("retourne null pour tout lot (lot_zone_resolution non disponible)", async () => {
    const db = makeMockDb([
      { codeAffiche: "H-609-4", kind: "H", evidence: [] },
    ]);
    const provider = await makeDbZoneVersionProvider(db, "salaberry-de-valleyfield");

    // Même avec des zones, sans lot_zone_resolution on ne peut pas résoudre noLot → zone
    const result = provider("4193751", "salaberry-de-valleyfield");
    expect(result).toBeNull();
  });
});

// ─── Tests makeIndexedZoneProvider ───────────────────────────────────────────

describe("makeIndexedZoneProvider — résolution via fonction de lookup", () => {
  it("retourne la ZoneVersionInput pour un noLot résolu", async () => {
    const db = makeMockDb([
      { codeAffiche: "H-609-4", kind: "H", evidence: [] },
    ]);
    const index = await makeCityZoneIndex(db, "salaberry-de-valleyfield");

    // Fonction de résolution fictive noLot → codeAffiche
    const resolve = (noLot: string) =>
      noLot === "4516943" ? "H-609-4" : null;

    const provider = makeIndexedZoneProvider(index, resolve);

    const result = provider("4516943", "salaberry-de-valleyfield");
    expect(result).not.toBeNull();
    expect(result?.kind).toBe("H");
    expect(result?.densiteLogHa).toBeNull();
  });

  it("retourne null si le noLot ne se résout pas", async () => {
    const db = makeMockDb([
      { codeAffiche: "H-609-4", kind: "H", evidence: [] },
    ]);
    const index = await makeCityZoneIndex(db, "salaberry-de-valleyfield");

    const resolve = (_noLot: string) => null;
    const provider = makeIndexedZoneProvider(index, resolve);

    const result = provider("9999999", "salaberry-de-valleyfield");
    expect(result).toBeNull();
  });

  it("retourne null si le codeAffiche n'est pas dans l'index", async () => {
    const db = makeMockDb([
      { codeAffiche: "H-609-4", kind: "H", evidence: [] },
    ]);
    const index = await makeCityZoneIndex(db, "salaberry-de-valleyfield");

    // Résout vers un code qui n'existe pas dans l'index
    const resolve = (_noLot: string) => "CODE-INEXISTANT";
    const provider = makeIndexedZoneProvider(index, resolve);

    const result = provider("4516943", "salaberry-de-valleyfield");
    expect(result).toBeNull();
  });

  it("retourne la bonne zone par noLot dans un index multi-zones", async () => {
    const db = makeMockDb([
      { codeAffiche: "H-609-4", kind: "H", evidence: [] },
      { codeAffiche: "C-201", kind: "C", evidence: [] },
    ]);
    const index = await makeCityZoneIndex(db, "salaberry-de-valleyfield");

    const lotToCode: Record<string, string> = {
      "4516943": "H-609-4",
      "4514460": "C-201",
    };
    const resolve = (noLot: string) => lotToCode[noLot] ?? null;
    const provider = makeIndexedZoneProvider(index, resolve);

    const zH = provider("4516943", "salaberry-de-valleyfield");
    const zC = provider("4514460", "salaberry-de-valleyfield");

    expect(zH?.kind).toBe("H");
    expect(zC?.kind).toBe("C");
  });
});
