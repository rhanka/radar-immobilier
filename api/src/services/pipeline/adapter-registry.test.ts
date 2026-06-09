import { describe, expect, it } from "vitest";

import {
  buildAdapterRegistry,
  defaultAdapterRegistry,
  type AdapterEntry,
} from "./adapter-registry.js";

function entry(sourceId: string, city: string): AdapterEntry {
  return {
    sourceId,
    city,
    // Build is never called in resolve-only tests (no network).
    build: () => {
      throw new Error("not built in this test");
    },
  };
}

describe("buildAdapterRegistry", () => {
  const reg = buildAdapterRegistry(
    [
      entry("role-evaluation-mamh-70052", "salaberry-de-valleyfield"),
      entry("role-evaluation-mamh-70022", "beauharnois"),
    ],
    {
      "roles-evaluation-fonciere-mamh": [
        "role-evaluation-mamh-70052",
        "role-evaluation-mamh-70022",
      ],
    },
  );

  it("resolves a concrete binding id directly", () => {
    expect(reg.resolve("role-evaluation-mamh-70052")?.city).toBe(
      "salaberry-de-valleyfield",
    );
  });

  it("resolves an abstract binding id, disambiguated by city", () => {
    expect(
      reg.resolve("roles-evaluation-fonciere-mamh", "beauharnois")?.sourceId,
    ).toBe("role-evaluation-mamh-70022");
  });

  it("skips a concrete binding whose city does not match the target city", () => {
    // Valleyfield concrete binding asked for the Beauharnois city → no match.
    expect(
      reg.resolve("role-evaluation-mamh-70052", "beauharnois"),
    ).toBeUndefined();
  });

  it("returns undefined for an unknown binding", () => {
    expect(reg.resolve("cptaq-zone-agricole")).toBeUndefined();
  });
});

describe("defaultAdapterRegistry", () => {
  const reg = defaultAdapterRegistry();

  it("resolves the real avis + rôle + adresses + reglements bindings", () => {
    expect(reg.resolve("avis-publics-valleyfield")?.city).toBe(
      "salaberry-de-valleyfield",
    );
    expect(reg.resolve("avis-publics-beauharnois")?.city).toBe("beauharnois");
    expect(reg.resolve("reglements-urbanisme-valleyfield")?.city).toBe(
      "salaberry-de-valleyfield",
    );
    expect(reg.resolve("role-evaluation-mamh-70052")?.city).toBe(
      "salaberry-de-valleyfield",
    );
    expect(reg.resolve("adresses-quebec-70022")?.city).toBe("beauharnois");
  });

  it("aliases the abstract rôle/adresses catalogue ids to concrete adapters", () => {
    expect(
      reg.resolve("roles-evaluation-fonciere-mamh", "salaberry-de-valleyfield")
        ?.sourceId,
    ).toBe("role-evaluation-mamh-70052");
    expect(
      reg.resolve("adresses-quebec-igo-geocoder", "beauharnois")?.sourceId,
    ).toBe("adresses-quebec-70022");
  });
});
