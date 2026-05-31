import { describe, it, expect } from "vitest";
import { valleyfieldDossiers } from "@radar/domain";
import { sourceContributions } from "./contribution.js";

describe("sourceContributions", () => {
  it("retourne au moins une contribution par dossier", () => {
    const contributions = sourceContributions(valleyfieldDossiers);
    expect(contributions.length).toBeGreaterThan(0);
  });

  it("trie par evidenceCount decroissant", () => {
    const contributions = sourceContributions(valleyfieldDossiers);
    for (let i = 1; i < contributions.length; i++) {
      expect(contributions[i - 1].evidenceCount).toBeGreaterThanOrEqual(
        contributions[i].evidenceCount,
      );
    }
  });

  it("le role foncier couvre les 3 dossiers (sourceId partagé)", () => {
    const contributions = sourceContributions(valleyfieldDossiers);
    const role = contributions.find((c) => c.sourceId === "role-70052-2026");
    expect(role).toBeDefined();
    expect(role!.dossierCount).toBe(3);
    expect(role!.evidenceCount).toBe(3);
  });

  it("youtube-conseil-valleyfield apparait dans la phase signal", () => {
    const contributions = sourceContributions(valleyfieldDossiers);
    const yt = contributions.find(
      (c) => c.sourceId === "youtube-conseil-valleyfield",
    );
    expect(yt).toBeDefined();
    expect(yt!.phases).toContain("signal");
  });

  it("le mix de verification de role-70052-2026 est uniquement 'fait'", () => {
    const contributions = sourceContributions(valleyfieldDossiers);
    const role = contributions.find((c) => c.sourceId === "role-70052-2026");
    expect(role).toBeDefined();
    expect(role!.verificationMix.fait).toBe(3);
    expect(role!.verificationMix.hypothese).toBe(0);
    expect(role!.verificationMix["non-disponible"]).toBe(0);
  });

  it("chaque contribution a au moins une phase", () => {
    const contributions = sourceContributions(valleyfieldDossiers);
    for (const c of contributions) {
      expect(c.phases.length).toBeGreaterThan(0);
    }
  });

  it("dossierIds contient uniquement des IDs connus", () => {
    const knownIds = new Set(valleyfieldDossiers.map((d) => d.id));
    const contributions = sourceContributions(valleyfieldDossiers);
    for (const c of contributions) {
      for (const dossierId of c.dossierIds) {
        expect(knownIds.has(dossierId)).toBe(true);
      }
    }
  });

  it("retourne un resultat stable sur un tableau vide", () => {
    expect(sourceContributions([])).toEqual([]);
  });
});
