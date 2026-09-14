export const fixedInstructions = {
  architectureOrder: ['before', 'after-T3-one-b3-8'],
  rolloutOrder: ['preproduction', 'production'],
  retainScwTemUntilValidatedReplacement: true,
  transitionEvidence: {
    asOfDate: '2026-09-13',
    t1: { graphify: '0.18.0', acceptanceModelTrial: 'Luna high', preproduction: 'accepted',
      production: 'dormant-pending-promotion', selectedProductionModel: null },
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
      production: { status: 'minio-removed-ovh-s3-active', accepted: true,
        parityJob: 'radar-object-storage-copy-docs-prod-vz8kd', objects: 59017, bytes: 12534514457,
        copied: 0, failed: 0, proofs: 'four SHA-256 anchored proofs' },
    },
    t3: { status: 'not-consolidated', createdNode: { sku: 'r2-15', allocatableMiB: 12785 },
      keda: 'removed', drainedB3Nodes: 0 },
  },
  reporting: {
    timezone: 'America/Toronto', startInclusive: '2026-08-10T00:00:00-04:00',
    endExclusive: '2026-09-14T00:00:00-04:00', days: 35, hours: 840,
    joinEvidence: 'preceding report at historical revision 72b966664523801ea00cfcb704e0285ee765c136; no main-ancestry claim',
    externalInvoiceBoundaryVerified: true, tokenCaptureCutoff: '2026-09-13T21:09:35.483Z',
  },
  billing: {
    position: 'last-annex', allocationMethodChoiceRequired: false, paidCadToDate: 0,
    invoices: [{ id: 'QC281819', period: 'July', paidCad: 0 }, { id: 'QC285954', period: 'August', paidCad: 0 }],
    trialCredit: { grantedCad: 270, consumedCad: 179.23, expiredCad: 90.77, expirationDate: '2026-08-12' },
    september: { estimatedUnbilledCad: 71.62, firstRealDebitExpectedAround: '2026-10-01' },
    node: { quantity: 1, sku: 'r2-15', monthlyProrataCad: 58.58,
      excluded: 'three b3-8 nodes (~180 CAD/month); operator error, never billable to the owner' },
    llm: { method: 'same subscription-capacity allocation and unit basis as preceding report',
      evidence: 'token-audit-2026-08-10_2026-09-13.json',
      status: 'provisional-non-critical-non-final', ratificationStatus: 'open-non-blocking' },
  },
};

export const questions = [
  { key: 'm1-model', criticality: 'architecture',
    question: 'Quel candidat M1 faut-il ratifier après un benchmark apparié complet ?',
    context: 'Aucun modèle n’est sélectionné. Laisser vide diffère la décision; le no-output Gemini reste non classable et ne constitue pas un résultat.',
    options: [
      { key: 'sonnet-comparable', title: 'Sonnet comparable', detail: 'Même corpus/prompt/schéma/cap; clé owner hors dépôt et hors logs.' },
      { key: 'luna-low', title: 'Luna low', detail: 'À exécuter sous le même contrat; le trial Luna high ne préjuge pas du résultat.' },
      { key: 'gemini38-lowest', title: 'Gemini 3.8 lowest', detail: 'À qualifier; une tentative sans sortie ne reçoit ni score ni rang.' },
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
    question: 'Quel statut donner à l’allocation LLM provisoire ?',
    context: 'Sans réponse, elle reste non critique, non finale, non ratifiée et ne constitue pas une facture.',
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
  const candidateRows = ['sonnet-comparable', 'luna-low', 'gemini38-lowest'].map(optionId => ({ optionId,
    state: optionId === 'gemini38-lowest' ? 'not-classifiable' : 'not-measured', resultId: null }));
  return { schema: 'immo-focus-owner-response/v7', dossier: 'immo-two-dated-transitions', revision: 'D9',
    dossierHash: manifest.dossierHash, artifactInputHash: manifest.artifactInputHash, capturedAt,
    buildOnly: true, status: 'draft-not-ratified',
    authority: 'open answers captured as a local draft; fixed owner decisions remain unchanged; no deployment, invoice or Track decision emitted',
    responses,
    m1Decision: { schema: 'docs/architecture/focus/m1-decision.schema.json', status: 'awaiting-matched-benchmark',
      optionSet: ['sonnet-comparable', 'luna-low', 'gemini38-lowest'], candidateRows,
      attempts: [{ attemptId: 'historical-gemini-no-output', optionId: 'gemini38-lowest', classification: 'not-classifiable', output: null,
        qualityMetrics: null, validOutputLatencyMs: null, rank: null }],
      candidateResults: [], ranking: [], draftSelectedOptionId: selections['m1-model'] ?? null, ratifiedOptionId: null,
      sonnetCredentialPolicy: 'owner-controlled token; read-only; outside repository, argv, logs, commits and PDF' },
    fixedInstructions, unresolvedEvidence: [
      'T1 valid-PDF provider completion, typed Signal/exact PDF, replay and schedule acceptance',
      'T3 post-cleanup capacity and placement acceptance',
      'LLM allocation method and final amount',
    ], remarks };
}
