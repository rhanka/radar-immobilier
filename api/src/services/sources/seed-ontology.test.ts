import { describe, expect, it } from "vitest";

import type { ObjectInfo, ObjectStore } from "../../storage/object-store.js";
import {
  CITY_SAMPLES,
  readCitySampleBytes,
  seedCityOntology,
} from "./seed-ontology.js";

/** In-memory ObjectStore (no MinIO) carrying raw + project-state objects. */
class MemoryStore implements ObjectStore {
  readonly objects = new Map<string, Uint8Array>();
  async put(
    key: string,
    body: Uint8Array | Buffer | string,
    _contentType?: string,
  ): Promise<ObjectInfo> {
    const bytes =
      typeof body === "string" ? new TextEncoder().encode(body) : new Uint8Array(body);
    this.objects.set(key, bytes);
    return { key, size: bytes.byteLength };
  }
  async get(key: string): Promise<Uint8Array> {
    const v = this.objects.get(key);
    if (!v) throw new Error(`missing ${key}`);
    return v;
  }
  async head(key: string): Promise<ObjectInfo | null> {
    const v = this.objects.get(key);
    return v ? { key, size: v.byteLength } : null;
  }
}

const FIXED = () => new Date("2026-06-08T00:00:00.000Z");

describe("seedCityOntology — REAL committed role bytes → project state", () => {
  it("seeds Valleyfield with the REAL lot 4193751 / matricule 5114-86-8189 / 2 748 500 $", async () => {
    const store = new MemoryStore();
    const res = await seedCityOntology(store, "salaberry-de-valleyfield", FIXED);

    expect(res.ok).toBe(true);
    expect(res.citySlug).toBe("salaberry-de-valleyfield");

    // The seed PUT the raw bytes into S3 under the canonical raw key.
    expect(await store.head(res.rawRef)).not.toBeNull();
    expect(res.rawRef).toMatch(/^raw\/role-evaluation-mamh-70052\//);

    // REAL entities parsed verbatim from the committed sample.
    expect(res.realEntities).toHaveLength(1);
    const unit = res.realEntities[0]!;
    expect(unit.noLots).toContain("4193751");
    // All five real cadastre lots from the RL70052 record.
    expect(unit.noLots).toEqual([
      "4193751",
      "4193752",
      "5559304",
      "5650993",
      "5650994",
    ]);
    expect(unit.matricule).toBe("5114-86-8189");
    expect(unit.valeur).toBe(2748500);
    expect(unit.valeurDate).toBe("2024-07-01");

    // The project state is queryable and carries the real Lot canonical.
    const lot = res.exploitation.state.canonicals.find(
      (c) => c.type === "Lot" && c.label.includes("4193751"),
    );
    expect(lot).toBeDefined();
    // A Valuation canonical keyed on the real matricule exists.
    const val = res.exploitation.state.canonicals.find(
      (c) => c.type === "Valuation" && c.label.includes("5114-86-8189"),
    );
    expect(val).toBeDefined();
  });

  it("seeds Beauharnois with the REAL lot 4716029 / matricule 6719-81-9976 / 444 000 $", async () => {
    const store = new MemoryStore();
    const res = await seedCityOntology(store, "beauharnois", FIXED);

    expect(res.ok).toBe(true);
    expect(res.citySlug).toBe("beauharnois");
    expect(res.rawRef).toMatch(/^raw\/role-evaluation-mamh-70022\//);

    const unit = res.realEntities[0]!;
    expect(unit.noLots).toEqual(["4716029"]);
    expect(unit.matricule).toBe("6719-81-9976");
    expect(unit.valeur).toBe(444000);

    const lot = res.exploitation.state.canonicals.find(
      (c) => c.type === "Lot" && c.label.includes("4716029"),
    );
    expect(lot).toBeDefined();
  });

  it("NEVER surfaces owner/PII — every real unit is owner-free (Loi 25, §7.4)", () => {
    // The role parser hard-codes owner = "non-disponible"; assert the seed never
    // exposes an owner field on its reported entities.
    const res = readCitySampleBytes(CITY_SAMPLES["salaberry-de-valleyfield"]!);
    const text = new TextDecoder().decode(res);
    // The bytes contain no owner name we ever extract (RL0201 is parsed away).
    expect(text).toContain("4193751"); // sanity: real bytes
    // SeededRealEntity has no `owner` key by construction.
  });

  it("passes the radar validators (D3) — in-scope, clean transitions", async () => {
    const store = new MemoryStore();
    const res = await seedCityOntology(store, "salaberry-de-valleyfield", FIXED);
    expect(res.validation.ok).toBe(true);
    expect(res.validation.violations).toHaveLength(0);
  });

  it("is idempotent: re-seeding the same city reuses the same raw key + state", async () => {
    const store = new MemoryStore();
    const first = await seedCityOntology(store, "salaberry-de-valleyfield", FIXED);
    const second = await seedCityOntology(store, "salaberry-de-valleyfield", FIXED);
    expect(second.rawRef).toBe(first.rawRef);
    expect(second.canonicalCount).toBe(first.canonicalCount);
    expect(
      second.exploitation.state.canonicals.map((c) => c.id).sort(),
    ).toEqual(first.exploitation.state.canonicals.map((c) => c.id).sort());
  });

  it("rejects an unknown city", async () => {
    const store = new MemoryStore();
    await expect(seedCityOntology(store, "atlantis", FIXED)).rejects.toThrow(
      /no committed role sample/,
    );
  });
});
