// Transparent filter: recomputes the verdict from the tags of the output schema
// (docs/reviews/oracle-c-draft/schema-sortie.md). Built only from Steve's three general criteria
// (residential, loosening, densification — "all three, not two out of three"), his stated
// exclusions, and his asymmetry reserve (an undetermined or mixed signal stays visible).
// It uses no triage line and no statistic.

export const TAGS = {
  residentiel: ['oui', 'non', 'indetermine'],
  sens: ['assouplissement', 'restriction', 'mixte', 'neutre', 'indetermine'],
  densification: ['oui', 'non', 'indetermine'],
  exclusions: ['piia', 'derogation_mineure', 'ppcmoi', 'usage_conditionnel', 'point_ordre_du_jour', 'point_retire',
    'cptaq_individuelle', 'non_urbanisme', 'sans_effet_capacite', 'autre'],
  type_acte: ['avis_motion', 'projet_reglement', 'second_projet', 'adoption', 'resolution', 'consultation', 'mandat',
    'demande', 'autre', 'indetermine'],
};

export const RULES = [
  ['R1', 'an exclusion is established (exclusions not empty)', 'Non pertinent'],
  ['R2', 'residentiel = non', 'Non pertinent'],
  ['R3', 'sens = mixte: Pertinent if residentiel = oui and densification = oui, otherwise À surveiller (a mixed bylaw never disappears)', 'Pertinent | À surveiller'],
  ['R4', 'sens = restriction or neutre (loosening established as absent)', 'Non pertinent'],
  ['R5', 'densification = non (no more units than before)', 'Non pertinent'],
  ['R6', 'residentiel = oui and sens = assouplissement and densification = oui (all three criteria)', 'Pertinent'],
  ['R7', 'otherwise (at least one criterion undetermined, none established as failed)', 'À surveiller'],
];

/** Returns { verdict, rule } for a tag object; throws on a value outside the schema. */
export function deriveVerdict(t) {
  for (const k of ['residentiel', 'sens', 'densification']) {
    if (!TAGS[k].includes(t[k])) throw new Error(`tag ${k}: invalid value ${t[k]}`);
  }
  if (!Array.isArray(t.exclusions) || t.exclusions.some((e) => !TAGS.exclusions.includes(e))) throw new Error('tag exclusions: invalid');
  if (t.exclusions.length) return { verdict: 'Non pertinent', rule: 'R1' };
  if (t.residentiel === 'non') return { verdict: 'Non pertinent', rule: 'R2' };
  if (t.sens === 'mixte') return { verdict: t.residentiel === 'oui' && t.densification === 'oui' ? 'Pertinent' : 'À surveiller', rule: 'R3' };
  if (t.sens === 'restriction' || t.sens === 'neutre') return { verdict: 'Non pertinent', rule: 'R4' };
  if (t.densification === 'non') return { verdict: 'Non pertinent', rule: 'R5' };
  if (t.residentiel === 'oui' && t.sens === 'assouplissement' && t.densification === 'oui') return { verdict: 'Pertinent', rule: 'R6' };
  return { verdict: 'À surveiller', rule: 'R7' };
}

/** Motif-code family must agree with the verdict (P- ↔ Pertinent, S- ↔ À surveiller, N-/V2- ↔ Non pertinent). */
export function motifConsistent(motif, verdict) {
  const fam = /^P-/.test(motif) ? 'Pertinent' : /^S-/.test(motif) ? 'À surveiller' : /^(N|V2)-/.test(motif) ? 'Non pertinent' : null;
  return fam === verdict;
}
