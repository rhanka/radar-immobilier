export const options = [
  { key: 'A', title: 'Refresh dans le pod, puis stockage',
    choice: 'Runner Immo checkpointé avec Graphify embarqué ; migration des stores après preuve de bout en bout.',
    strengths: 'Réutilise CAS/Graphify ; prouve tôt le résultat utilisateur.',
    tradeoffs: 'Risque d’un orchestrateur jetable ou d’un writer de trop.',
    costRisk: 'Intégration et migration non chiffrées ; avantage comparatif non établi.',
    reversibility: 'Bonne avant écriture ; checkpoints cohérents nécessaires après.',
    winsIf: 'Gates et writer existants réellement réutilisables sans contourner E4/E5.' },
  { key: 'B', title: 'DAG E1–E5 complet d’abord',
    choice: 'Mettre en place les couches acquisition, détection, grounding, merge et projection avant la bascule.',
    strengths: 'Frontières de recalcul durables ; merge/projection uniques dès le départ.',
    tradeoffs: 'Plus de contrats changent avant la première preuve utilisateur.',
    costRisk: 'Périmètre initial présumé le plus large, reste-à-faire à confirmer.',
    reversibility: 'Plus difficile avec des contrats et outputs de versions mixtes.',
    winsIf: 'A ne garantit pas reprise et writers exclusifs, ou B est presque prêt.' },
  { key: 'C', title: 'Stockage d’abord, poste LLM temporaire',
    choice: 'Isoler la sortie des stores legacy ; conserver temporairement le traitement LLM sur le poste.',
    strengths: 'Isole migration et extraction ; teste les lecteurs/writers existants.',
    tradeoffs: 'Ne livre pas le refresh autonome ; migre des publishers bientôt modifiés.',
    costRisk: 'Moins de code initial, coordination supplémentaire ; coût total inconnu.',
    reversibility: 'Code plus simple à revenir ; données toujours à restaurer.',
    winsIf: 'Une urgence stockage vérifiée prime sur l’autonomie.' },
];

export function responsePack(manifest, option, note, remarks, capturedAt) {
  if (option !== null && !options.some(o => o.key === option)) throw Error('Unknown decision option');
  return { schema: 'immo-focus-decision-response/v1', dossier: 'immo-refresh-storage', revision: 'D3',
    dossierHash: manifest.dossierHash, artifactInputHash: manifest.artifactInputHash, capturedAt,
    buildOnly: true, status: 'draft-not-ratified',
    decision: { key: 'refresh-sequence', option, decisionStatus: 'owner-draft-not-ratified', note },
    options, remarks, fixedDecisions: { pvPipelineOwner: 'Immo', rolloutOrder: ['preprod', 'production'], retainScwTemUntilValidatedReplacement: true } };
}
