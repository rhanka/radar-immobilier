/**
 * Unit tests for the governed catalogue derivation (I-1A, converged r3 §1).
 *
 * Only `qc-zonage-*` collections with a known licence, present rights, and a
 * complete dated per-collection record are served. Everything else is listed
 * with an explicit status — never served. Pure derivation: no network.
 */
import { describe, expect, it } from "vitest";
import {
  GOVERNED_SERVED_RECORDS,
  catalogueCollection,
  catalogueCollections,
  parseGovernedFamily,
} from "./governed-policy.js";

const CC_BY_4 = "Creative Commons Attribution 4.0 International";
const PILOT = "qc-zonage-gatineau-affectations-territoire";

describe("parseGovernedFamily", () => {
  it("classifies the geo families, zoning-events before zonage", () => {
    expect(parseGovernedFamily("qc-zonage-gatineau-affectations-territoire")).toBe("zonage");
    expect(parseGovernedFamily("qc-zoning-events-candiac")).toBe("zoning-events");
    expect(parseGovernedFamily("qc-zonage-norms-grille")).toBe("zonage-norms");
    expect(parseGovernedFamily("qc-lots-delson")).toBe("lots");
    expect(parseGovernedFamily("qc-tod-delson")).toBe("tod");
    expect(parseGovernedFamily("ca-qc-constraints-xyz")).toBe("constraints");
    expect(parseGovernedFamily("rosemere")).toBe("other");
  });
});

describe("catalogueCollection (fail-closed per collection)", () => {
  it("serves the pilot record when licence, record and rights all hold", () => {
    const entry = catalogueCollection({ id: PILOT, licenseTitle: CC_BY_4, rightsPresent: true });
    expect(entry.status).toBe("served");
    expect(entry.record?.collectionId).toBe(PILOT);
    expect(entry.record?.licenseId).toBe("cc-by-4.0");
    expect(entry.reason).toBeUndefined();
  });

  it("lists the business pilot gap as unknown (Valleyfield, live licence unknown)", () => {
    const entry = catalogueCollection({
      id: "qc-zonage-salaberry-de-valleyfield",
      licenseTitle: "Unknown license",
      rightsPresent: false,
    });
    expect(entry.status).toBe("unknown");
    expect(entry.reason).toBe("licence-unmatched-title");
  });

  it("marks licence-known zonage without a dated record as not covered", () => {
    const entry = catalogueCollection({
      id: "qc-zonage-laval-sad-centre-ville",
      licenseTitle: CC_BY_4,
      rightsPresent: true,
    });
    expect(entry.status).toBe("not covered");
    expect(entry.reason).toBe("no-dated-per-collection-record");
  });

  it("marks licence-known zonage with missing rights as not covered", () => {
    const entry = catalogueCollection(
      { id: PILOT, licenseTitle: CC_BY_4, rightsPresent: false },
      GOVERNED_SERVED_RECORDS,
    );
    expect(entry.status).toBe("not covered");
    expect(entry.reason).toBe("rights-missing");
  });

  it("marks licence-known zonage without a dated record as not covered (record first)", () => {
    const entry = catalogueCollection({
      id: "qc-zonage-laval-sad-centre-ville",
      licenseTitle: CC_BY_4,
      rightsPresent: true,
    });
    expect(entry.status).toBe("not covered");
    expect(entry.reason).toBe("no-dated-per-collection-record");
  });

  it("keeps a J1 city zoning record not covered while the live listing renders no rights", () => {
    const entry = catalogueCollection({
      id: "qc-zonage-rosemere",
      licenseTitle: "Plan de zonage municipal Ville de Rosemère",
      rightsPresent: false,
    });
    expect(entry.status).toBe("not covered");
    expect(entry.reason).toBe("rights-missing");
    const served = catalogueCollection({
      id: "qc-zonage-rosemere",
      licenseTitle: "Plan de zonage municipal Ville de Rosemère",
      rightsPresent: true,
    });
    expect(served.status).toBe("served");
    expect(served.record?.zoning?.projection).toBe("zoning-v1");
  });

  it("lists lots and zoning events as not served, whatever the licence", () => {
    expect(
      catalogueCollection({ id: "qc-lots-delson", licenseTitle: CC_BY_4, rightsPresent: true })
        .status,
    ).toBe("not served");
    expect(
      catalogueCollection({
        id: "qc-zoning-events-candiac",
        licenseTitle: "Unknown license",
        rightsPresent: false,
      }),
    ).toMatchObject({ status: "not served", reason: "family-zoning-events-deferred-in-i1a" });
  });

  it("lists deferred families (norms, tod, constraints, other) as not served", () => {
    for (const id of [
      "qc-zonage-norms-grille",
      "qc-tod-delson",
      "ca-qc-constraints-xyz",
      "rosemere",
    ]) {
      expect(catalogueCollection({ id, licenseTitle: CC_BY_4, rightsPresent: true }).status).toBe(
        "not served",
      );
    }
  });

  it("refuses an ambiguous title as unknown with an injectable registry (no upstream)", () => {
    const duplicated = [
      { id: "licence-a", title: "Same Title" },
      { id: "licence-b", title: "Same Title" },
    ];
    const entry = catalogueCollection(
      { id: PILOT, licenseTitle: "Same Title", rightsPresent: true },
      GOVERNED_SERVED_RECORDS,
      duplicated,
    );
    expect(entry.status).toBe("unknown");
    expect(entry.reason).toBe("licence-ambiguous-title");
    expect(entry.record).toBeUndefined();
  });

  it("refuses a record whose licence id no longer matches the live title", () => {
    const entry = catalogueCollection(
      { id: PILOT, licenseTitle: "Unknown license", rightsPresent: true },
      GOVERNED_SERVED_RECORDS,
    );
    expect(entry.status).toBe("unknown");
  });
});

describe("derived rights (PR #1010 follow-up, conductor decision)", () => {
  const HONFLEUR = "qc-zonage-honfleur";

  it("serves a CC-BY record without geo rights on rights derived from the licence", () => {
    const entry = catalogueCollection({ id: HONFLEUR, licenseTitle: CC_BY_4, rightsPresent: false });
    expect(entry.status).toBe("served");
    expect(entry.rightsSource).toBe("derived-from-licence");
    expect(entry.rightsPresent).toBe(false);
    expect(entry.record?.rights).toMatchObject({ source: "derived-from-licence", licenceId: "cc-by-4.0" });
  });

  it("lets a geo-rendered rights object take precedence", () => {
    const entry = catalogueCollection({ id: HONFLEUR, licenseTitle: CC_BY_4, rightsPresent: true });
    expect(entry.status).toBe("served");
    expect(entry.rightsSource).toBe("geo");
  });

  it("refuses an unknown or unregistered live licence even with a derived-rights record", () => {
    for (const title of ["Unknown license", "Creative Commons Attribution 4.0", undefined]) {
      const entry = catalogueCollection({ id: HONFLEUR, licenseTitle: title, rightsPresent: false });
      expect(entry.status).toBe("unknown");
      expect(entry.record).toBeUndefined();
    }
  });

  it("keeps Portneuf and Rosemère not covered without geo rights (unverified redistributability)", () => {
    for (const [id, title] of [
      ["qc-zonage-neuville", "Donnée publique municipale (zonage) — MRC de Portneuf"],
      ["qc-zonage-saint-gilbert", "Donnée publique municipale (zonage) — MRC de Portneuf"],
      ["qc-zonage-rosemere", "Plan de zonage municipal Ville de Rosemère"],
    ] as const) {
      const entry = catalogueCollection({ id, licenseTitle: title, rightsPresent: false });
      expect(entry.status, id).toBe("not covered");
      expect(entry.reason, id).toBe("rights-missing");
    }
  });

  it("never derives rights for a licence the registry does not mark redistributable", () => {
    const record = GOVERNED_SERVED_RECORDS.find((r) => r.collectionId === HONFLEUR)!;
    const registry = [{ id: "cc-by-4.0", title: CC_BY_4, redistribution: "unverified" as const }];
    expect(catalogueCollection({ id: HONFLEUR, licenseTitle: CC_BY_4, rightsPresent: false }, [record], registry))
      .toMatchObject({ status: "not covered", reason: "rights-missing" });
    const noFlag = [{ id: "cc-by-4.0", title: CC_BY_4 }];
    expect(catalogueCollection({ id: HONFLEUR, licenseTitle: CC_BY_4, rightsPresent: false }, [record], noFlag).status)
      .toBe("not covered");
  });

  it("never derives rights when the record's derived licence differs from the live one", () => {
    const record = GOVERNED_SERVED_RECORDS.find((r) => r.collectionId === HONFLEUR)!;
    const forged = { ...record, rights: { ...record.rights!, licenceId: "portneuf-zonage-municipal" } };
    expect(catalogueCollection({ id: HONFLEUR, licenseTitle: CC_BY_4, rightsPresent: false }, [forged]).status)
      .toBe("not covered");
  });
});

describe("catalogueCollections (live-shaped fixture)", () => {
  it("derives served + refused from a live-shaped listing", () => {
    const entries = catalogueCollections([
      { id: PILOT, licenseTitle: CC_BY_4, rightsPresent: true },
      { id: "qc-zonage-salaberry-de-valleyfield", licenseTitle: "Unknown license", rightsPresent: false },
      { id: "qc-lots-salaberry-de-valleyfield", licenseTitle: "Unknown license", rightsPresent: false },
      { id: "qc-zoning-events-candiac", licenseTitle: "Unknown license", rightsPresent: false },
      { id: "qc-zonage-laval-sad-centre-ville", licenseTitle: CC_BY_4, rightsPresent: true },
    ]);
    expect(entries.filter((e) => e.status === "served").map((e) => e.collectionId)).toEqual([
      PILOT,
    ]);
    expect(entries.filter((e) => e.status !== "served")).toHaveLength(4);
  });
});
