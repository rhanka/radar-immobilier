export const fixedInstructions = {
  architectureOrder: ['before', 'effective-transition-2026-09-13', 'after-T2', 'after-T3-one-b3-8'],
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
      copyTooling: { branch: 'chore/scw-final-sweep', head: 'be362561', onOriginMain: false },
      copyToolingCommitted: true, docsCopy: false, docsParityRecovery: false, docsRebind: false,
      productionAuditMigration: 'launched; completed outcome unknown', minioRetainedUntilExactParityAndRecovery: true,
    },
    t3: { status: 'not-started', verdict: 'NO-GO today', targetNodes: 1,
      requiredSequence: ['T2 complete', 'rightsizing', 'constraints reconciled', 'verified two-node step', 'one-node test'] },
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
      totalFacturableCad: 251.21543767641742, evidence: 'token-audit-2026-08-10_2026-09-13.json' },
    indicativeTotalCad: 320.0954376764174,
  },
};

export function responsePack(manifest, note, remarks, capturedAt) {
  return { schema: 'immo-focus-owner-instructions/v4', dossier: 'immo-before-transition-after-and-reporting', revision: 'D6',
    dossierHash: manifest.dossierHash, artifactInputHash: manifest.artifactInputHash, capturedAt,
    buildOnly: true, status: 'effective-transition-recorded; acceptance-gates-open',
    authority: 'facts and fixed instructions captured; no deployment, invoice or Track decision emitted',
    option: null, optionInterpretation: 'No genuine balanced decision is open; no option is presented.',
    fixedInstructions, unresolvedEvidence: [
      'T1 valid-PDF provider completion, typed Signal/exact PDF, replay and schedule acceptance',
      'T2 DOCS copy, parity/recovery and rebind',
      'production object audit/migration outcome', 'T3 capacity and placement acceptance',
      'external invoice identity, if it differs from the merged repository report boundary',
    ], note, remarks };
}
