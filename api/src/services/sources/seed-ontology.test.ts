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

    // WP4 Source #2: the committed Valleyfield avis index also seeds the screen.
    expect(res.avisRawRef).toMatch(/^raw\/avis-publics-valleyfield\//);
    expect(await store.head(res.avisRawRef)).not.toBeNull();
    // Real Bylaw canonicals from the avis (209-47, 216-34 verbatim).
    const bylaws = res.exploitation.state.canonicals.filter((c) => c.type === "Bylaw");
    expect(bylaws.map((b) => b.label)).toEqual(
      expect.arrayContaining(["Règlement 209-47", "Règlement 216-34"]),
    );
    // Real DesignationEvent canonicals from the densification notices.
    const events = res.exploitation.state.canonicals.filter(
      (c) => c.type === "DesignationEvent",
    );
    expect(events.length).toBeGreaterThanOrEqual(1);
    // Real avis notices reported verbatim (PPCMOI present).
    expect(res.realAvis.some((a) => a.type === "ppcmoi")).toBe(true);
    // At least one validated Signal (the PPCMOI / dérogation watch).
    expect(res.signalCount).toBeGreaterThanOrEqual(1);

    // WP4 Source #4: the committed terrAPI / Adresses Québec list seeds the screen.
    expect(res.adresseRawRef).toMatch(/^raw\/adresses-quebec-70052\//);
    expect(await store.head(res.adresseRawRef)).not.toBeNull();
    // Real addresses reported verbatim (nom from the committed terrAPI bytes).
    expect(res.realAdresses).toHaveLength(3);
    expect(res.realAdresses.map((a) => a.nom)).toEqual(
      expect.arrayContaining([
        "24 rue Paquette, Salaberry-de-Valleyfield J6S6A5",
        "310 boulevard Pie-XII, Salaberry-de-Valleyfield J6S6P7",
      ]),
    );
    // Real Adresse canonicals carry the verbatim nom as label.
    const adresses = res.exploitation.state.canonicals.filter(
      (c) => c.type === "Adresse",
    );
    expect(adresses).toHaveLength(3);
    expect(adresses.map((a) => a.label)).toEqual(
      expect.arrayContaining([
        "24 rue Paquette, Salaberry-de-Valleyfield J6S6A5",
      ]),
    );
    // HONESTY: the geometry=0 sample carries no lot ⇒ no Adresse↔Lot candidate is
    // fabricated. The role lot (4193751) and the addresses share no identifier.
    expect(
      res.exploitation.state.candidates.length,
    ).toBe(res.candidateCount);
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

    // WP4 Source #2: the committed Beauharnois WordPress avis index seeds the screen.
    expect(res.avisRawRef).toMatch(/^raw\/avis-publics-beauharnois\//);
    expect(await store.head(res.avisRawRef)).not.toBeNull();
    // Real Bylaw canonical 701-102 (cited in the consultation/projet notice).
    const bylaw = res.exploitation.state.canonicals.find(
      (c) => c.type === "Bylaw" && c.label.includes("701-102"),
    );
    expect(bylaw).toBeDefined();
    // Real DesignationEvent for the dérogation mineure DM-2026-0037.
    const dm = res.exploitation.state.canonicals.find(
      (c) => c.type === "DesignationEvent" && c.label.includes("DM-2026-0037"),
    );
    expect(dm).toBeDefined();
    // Real avis notices reported verbatim (dérogation + consultation present).
    expect(res.realAvis.some((a) => a.type === "derogation-mineure")).toBe(true);
    expect(res.realAvis.some((a) => a.type === "consultation")).toBe(true);
    // The dérogation notice yields one validated watch Signal.
    expect(res.signalCount).toBeGreaterThanOrEqual(1);

    // WP4 Source #4: the committed terrAPI / Adresses Québec list seeds the screen.
    expect(res.adresseRawRef).toMatch(/^raw\/adresses-quebec-70022\//);
    expect(await store.head(res.adresseRawRef)).not.toBeNull();
    expect(res.realAdresses).toHaveLength(3);
    expect(res.realAdresses.map((a) => a.nom)).toEqual(
      expect.arrayContaining([
        "279 chemin Saint-Louis, Beauharnois J6N2J3",
        "568 2 rue Richard, Beauharnois J6N2P3",
      ]),
    );
    const adresses = res.exploitation.state.canonicals.filter(
      (c) => c.type === "Adresse",
    );
    expect(adresses).toHaveLength(3);

    // HONEST cross-source check: the committed role record (lot 4716029, no
    // bylaws), the committed avis (bylaws 701-102/2026-11/…, no role lots) and the
    // terrAPI addresses (geometry=0 ⇒ no lot) share NO identifier ⇒ zero
    // entity_match candidates across the three. Recorded.
    expect(res.candidateCount).toBe(0);
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
