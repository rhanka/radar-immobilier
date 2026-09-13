export const fixedInstructions = {
  architectureOrder: ['before', 'after-T3-one-b3-8'],
  rolloutOrder: ['preproduction', 'production'],
  retainScwTemUntilValidatedReplacement: true,
  transitionEvidence: {
    asOfDate: '2026-09-13',
    t1: {
      graphify: '0.18.0', model: 'Luna high', status: 'validation-in-progress',
      firstKubernetesRun: 'failed-before-LLM', failure: 'input object was .html; PDF required',
      providerCompletion: false, typedSignalAndExactPdf: false, scheduleAcceptance: false,
    },
    t2: {
      decision: 'MIGRATE+RETAIN', rawParity: true, rawOvhRebind: true,
      docsBucketProvisioned: true, docsSecretProvisioned: true,
      docsInventory: { preprodMinio: { objects: 144193, gigabytes: 28.34 }, productionScwDocsPocs: { objects: 59017, bytes: 12534514457 } },
      canonicalReference: 'production SCW docs-pocs exact 59,017 keys+hashes', preprodSurplusMigrated: false,
      implementation: { branch: 'chore/scw-final-sweep', head: '2ccabfc8', onOriginMain: false },
      preproduction: { status: 'accepted', objects: 59017, bytes: 12534514457,
        canonicalManifestSha256: '52646a7b…0425', failed: 0, docsOvhActive: true,
        removed: ['MinIO StatefulSet', 'MinIO Pod', 'MinIO Service', '40 Gi data PVC', 'six MinIO NetworkPolicies'],
        retained: ['migration/checkpoint PVC'], quotaBefore: { pvcs: 4, storageGi: 47 }, quotaAfter: { pvcs: 3, storageGi: 7 },
        workloadsReady: { api: '1/1', mcp: '1/1', ui: '1/1' } },
      production: { status: 'in-progress', accepted: false },
    },
    t3: { status: 'gated', verdict: 'await production T2 and post-cleanup capacity proof', targetNodes: 1,
      requiredSequence: ['production T2 complete', 'post-cleanup remeasurement', 'rightsizing', 'constraints reconciled', 'verified two-node step', 'one-node test'] },
  },
  reporting: {
    timezone: 'America/Toronto', startInclusive: '2026-08-10T00:00:00-04:00',
    endExclusive: '2026-09-14T00:00:00-04:00', days: 35, hours: 840,
    joinEvidence: 'last cost report merged on origin/main ends 2026-08-09',
    externalInvoiceBoundaryVerified: false, tokenCaptureCutoff: '2026-09-13T21:09:35.483Z',
  },
  billing: {
    position: 'last-annex', allocationMethodChoiceRequired: false,
    node: { quantity: 1, sku: 'b3-8', region: 'BHS5', hourlyRateCad: 0.082, periodHours: 840, projectedAmountCad: 68.88,
      excluded: 'observed two/three-node platform pass-through/internal costs' },
    llm: { method: 'same subscription-capacity allocation and unit basis as preceding report',
      immoFacturableCad: 139.33773242975033, geoFacturableCad: 111.87770524666708,
      totalFacturableCad: 251.21543767641742, evidence: 'token-audit-2026-08-10_2026-09-13.json',
      ratificationStatus: 'open-non-blocking' },
    indicativeTotalCad: 320.0954376764174,
  },
};

export const questions = [
  { key: 'preprod-address', criticality: 'non-blocking',
    question: 'Quelle adresse doit devenir le point d’entrée propriétaire de la préproduction ?',
    context: 'Les preuves confirment preprod.immo.sent-tech.ca; preprod.sent-tech.ca reste une intention non tranchée.',
    options: [
      { key: 'KEEP_VERIFIED', title: 'Conserver l’adresse vérifiée', detail: 'Garder preprod.immo.sent-tech.ca comme entrée canonique.' },
      { key: 'ALIAS_PORTAL', title: 'Créer un alias ou portail', detail: 'Faire de preprod.sent-tech.ca une entrée distincte, après conception et vérification.' },
      { key: 'DEFER', title: 'Différer', detail: 'Ne changer aucune adresse tant que le besoin propriétaire n’est pas précisé.' },
    ] },
  { key: 'automation-scope', criticality: 'architecture',
    question: 'Le périmètre futur d’automatisation doit-il rester limité à Immo ou inclure les extractions Geo assistées ?',
    context: 'Cette question ne rouvre pas la propriété ratifiée du pipeline PV Immo.',
    options: [
      { key: 'IMMO_ONLY', title: 'Automatisation Immo seulement', detail: 'Le worker couvre Graphify/grounding Immo; Geo garde ses traitements séparés.' },
      { key: 'IMMO_AND_GEO', title: 'Étendre aux extractions Geo', detail: 'Concevoir un périmètre coordonné pour règlements et grilles, sans transférer la propriété du pipeline PV.' },
      { key: 'DEFER', title: 'Différer', detail: 'Attendre les preuves T1/T2 avant de définir cette extension.' },
    ] },
  { key: 'llm-billing', criticality: 'non-critical',
    question: 'Quel statut donner à l’allocation LLM auditée de 251,215438 CAD ?',
    context: 'Sans réponse, elle reste une allocation indicative non ratifiée et ne bloque pas l’architecture.',
    options: [
      { key: 'KEEP_INDICATIVE', title: 'Laisser indicative', detail: 'Conserver le calcul comme information non facturée et non bloquante.' },
      { key: 'RATIFY_METHOD', title: 'Ratifier la méthode', detail: 'Accepter la méthode d’allocation, sous réserve de l’identité de facture externe.' },
      { key: 'RECONCILE_FIRST', title: 'Rapprocher avant décision', detail: 'Comparer aux factures fournisseur avant toute ratification.' },
    ] },
];

export function responsePack(manifest, selections = {}, comments = {}, remarks = '', capturedAt = null) {
  const responses = questions.map(question => {
    const selection = selections[question.key] ?? null;
    if (selection !== null && !question.options.some(option => option.key === selection)) throw Error(`Unknown option ${selection} for ${question.key}`);
    return { key: question.key, question: question.question, criticality: question.criticality,
      selection, decisionStatus: selection === null ? (question.criticality === 'non-critical' ? 'open-non-blocking' : 'open') : 'owner-draft-not-ratified',
      comment: comments[question.key] ?? '', options: question.options };
  });
  return { schema: 'immo-focus-owner-response/v6', dossier: 'immo-before-after-and-reporting', revision: 'D8',
    dossierHash: manifest.dossierHash, artifactInputHash: manifest.artifactInputHash, capturedAt,
    buildOnly: true, status: 'draft-not-ratified',
    authority: 'open answers captured as a local draft; fixed owner decisions remain unchanged; no deployment, invoice or Track decision emitted',
    responses,
    fixedInstructions, unresolvedEvidence: [
      'T1 valid-PDF provider completion, typed Signal/exact PDF, replay and schedule acceptance',
      'production T2 DOCS copy, parity/recovery, rebind and MinIO removal',
      'T3 post-cleanup capacity and placement acceptance',
      'external invoice identity, if it differs from the merged repository report boundary',
    ], remarks };
}
