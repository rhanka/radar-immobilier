export const options = [
  { key: 'DIRECT', title: 'Dépense fournisseur attribuable',
    choice: 'Affecter seulement les lignes API ou abonnements reliés sans ambiguïté à Immo/Geo ; garder le reste séparé.',
    strengths: 'Reste au plus près d’une dépense fournisseur réellement observée.',
    tradeoffs: 'Les forfaits par siège ne donnent pas tous une ligne par produit ou dépôt.',
    costRisk: 'Montant inconnu avant rapprochement des factures, comptes, appels et projets.',
    reversibility: 'Règle simple à rejouer ; une dépense non attribuée reste visible, pas forcée.',
    winsIf: 'Les exports fournisseur permettent une attribution complète et vérifiable.' },
  { key: 'USAGE', title: 'Usage audité pondéré',
    choice: 'Répartir la dépense payée selon les appels dédupliqués de la fenêtre, pondérés par provider et type de tokens.',
    strengths: 'Relie l’allocation à l’usage du produit dans la période exacte.',
    tradeoffs: 'Exige attribution des sessions et ventilation input, cache write/read et output sans double compte.',
    costRisk: 'Montant inconnu tant que la fenêtre, la déduplication, le cache et les tarifs ne sont pas réconciliés.',
    reversibility: 'Recalculable à partir d’un journal gelé et d’une formule versionnée.',
    winsIf: 'L’audit exact des appels est complet et les coûts partagés ont une règle explicite.' },
  { key: 'CAPACITY', title: 'Capacité historique de pointe',
    choice: 'Conserver la normalisation historique par pic glissant de sept jours projeté sur trente jours.',
    strengths: 'Préserve la continuité avec le calcul historique déjà documenté.',
    tradeoffs: 'Mesure une allocation de capacité, pas une facture provider ; le pic peut être hors de la fenêtre produit.',
    costRisk: '214,743159 CAD est le résultat LLM historique Immo+Geo, pas un montant final audité.',
    reversibility: 'La formule est rejouable ; son résultat peut être remplacé après audit sans changer les faits d’usage.',
    winsIf: 'La continuité de capacité est retenue explicitement après l’audit des tokens et dépenses.' },
];

export function responsePack(manifest, option, note, remarks, capturedAt) {
  if (option !== null && !options.some(o => o.key === option)) throw Error('Unknown decision option');
  return { schema: 'immo-focus-decision-response/v2', dossier: 'immo-transitions-and-monthly-allocation', revision: 'D4',
    dossierHash: manifest.dossierHash, artifactInputHash: manifest.artifactInputHash, capturedAt,
    buildOnly: true, status: 'draft-not-ratified', monetaryProposalAudit: 'incomplete',
    decision: { key: 'llm-allocation-method', option, decisionStatus: 'owner-draft-not-ratified', note },
    options, remarks, fixedDecisions: {
      pvPipelineOwner: 'Immo', rolloutOrder: ['preprod', 'production'],
      executionOrder: ['T1-refresh-graphify-0.18.0', 'T2-minio-final-scw-sweep', 'T3-one-b3-8'],
      retainScwTemUntilValidatedReplacement: true,
      infrastructureBilling: { basis: 'one-b3-8-node-projection', region: 'BHS5', hourlyRateCad: 0.082,
        hours: 720, projectedNodeCad: 59.04, extraNodePassThrough: false, nonNodeCosts: 'audit-incomplete' },
      reportWindow: '2026-08-12T00:00:00-04:00/2026-09-10T23:59:59-04:00',
      september13Transitions: 'post-period', monetaryProposalAudit: 'incomplete' } };
}
