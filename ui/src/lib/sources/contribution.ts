/**
 * contribution.ts
 *
 * Helper pur : agregation de la contribution de chaque source de donnees
 * (sourceId) aux faisceaux de preuves des dossiers Valleyfield.
 *
 * Repond a la question : "qu'est-ce que vaut / contribue chaque datasource ?"
 * (UAT #5 / BR-05R).
 */

import type { OpportunityDossierT, PhaseT, VerificationT } from "@radar/domain";

export interface VerificationMix {
  fait: number;
  hypothese: number;
  "non-disponible": number;
  "simule": number;
}

export interface SourceContribution {
  sourceId: string;
  /** Libelle de la premiere preuve trouvee pour ce sourceId */
  label: string;
  dossierCount: number;
  evidenceCount: number;
  phases: PhaseT[];
  verificationMix: VerificationMix;
  dossierIds: string[];
}

/**
 * Agregation des preuves de tous les dossiers par sourceId.
 * Retourne un tableau trie par evidenceCount decroissant.
 */
export function sourceContributions(
  dossiers: OpportunityDossierT[],
): SourceContribution[] {
  const map = new Map<
    string,
    {
      label: string;
      dossierIds: Set<string>;
      phases: Set<PhaseT>;
      mix: VerificationMix;
      count: number;
    }
  >();

  for (const dossier of dossiers) {
    for (const ev of dossier.evidence) {
      const key = ev.sourceId;
      if (!map.has(key)) {
        map.set(key, {
          label: ev.label,
          dossierIds: new Set(),
          phases: new Set(),
          mix: { fait: 0, hypothese: 0, "non-disponible": 0, "simule": 0 },
          count: 0,
        });
      }
      const entry = map.get(key)!;
      entry.dossierIds.add(dossier.id);
      entry.phases.add(ev.phase);
      entry.count += 1;

      const v = ev.verification as VerificationT;
      if (v === "fait") entry.mix.fait += 1;
      else if (v === "hypothese") entry.mix.hypothese += 1;
      else if (v === "non-disponible") entry.mix["non-disponible"] += 1;
      else if (v === "simulé") entry.mix["simule"] += 1;
    }
  }

  const result: SourceContribution[] = [];

  for (const [sourceId, entry] of map.entries()) {
    result.push({
      sourceId,
      label: entry.label,
      dossierCount: entry.dossierIds.size,
      evidenceCount: entry.count,
      phases: Array.from(entry.phases),
      verificationMix: entry.mix,
      dossierIds: Array.from(entry.dossierIds),
    });
  }

  result.sort((a, b) => b.evidenceCount - a.evidenceCount);

  return result;
}
