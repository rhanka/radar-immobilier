export const ownerCorrection = {
  capturedAt: '2026-09-13T15:10:18.423Z', sourceRevision: 'D4',
  dossierHash: 'b001cefd850820d684fe701f5788463c28ac9f48a04c6be339c812d0c94f6451',
  artifactInputHash: '92b87297fbc8ed0f2670fa4fd07e1dde6d061d04533d3695275c1f386b3b032e',
  option: null, interpretation: 'No allocation method was selected. D5 records fixed instructions, not a method ratification.',
  comment: 'LLM costs last; use the same unit tariffs as the previous month actual invoice. Start at the real preceding invoice/report boundary once verified; end September 13 inclusive. September 13 transitions are in-period.',
};

export const fixedInstructions = {
  architectureOrder: ['existing', 'T1-refresh-graphify-0.18.0', 'T2-ovh-object-cutover-final-scw-sweep', 'T3-one-existing-b3-8'],
  rolloutOrder: ['preproduction', 'production'], pvPipelineOwner: 'Immo',
  retainScwTemUntilValidatedReplacement: true,
  transitionEvidence: {
    asOfDate: '2026-09-13', exactLatestUtcCutoff: null,
    t1: { graphify: '0.18.0', llmMesh: '0.19.0', socketFailurePolicy: 'fail Job closed; resume durable state next cycle; no in-process retry', llmMesh0191Required: false, diagnosticOwner: 's-conductor', implementationRequested: false, fableBlockAt: 'ac3a7150', correctiveCommits: ['537b9e0c', '3d9ed43c'], tests: { scoped: '34/34', integration: '4/4', typecheck: 'pass' }, fableRereview: 'in progress', providerSignal: false, kubernetesAcceptance: false, status: 'BLOCKED' },
    extractionBenchmark: { requiredBeforeRealExtraction: true, pdfCount: 5, tracks: ['historical/manual', 'v1', 'v2', 'v3'], simulatedRunsAccepted: false, modelSelected: false, cloudCodeEnrolled: false, scores: null },
    t2: { decision: 'MIGRATE+RETAIN', remediationCommits: ['ee84ae29', 'f2ac3825', 'c30467ca', 'cef6d7ed'], checkpointCommits: ['aaf0cbf7', '91242223'], checkpointStatus: 'under construction', copyStarted: false, cutoverStarted: false, deletionStarted: false, retainLegacyUntil: 'complete parity and recovery' },
    t3: { verdict: 'NO-GO today', nodes: 3, requests: '4095m/8442Mi', currentPodMemoryMi: 5273, oneNodeAllocatable: '1840m/5907.82Mi', pvc: '16 total / 15 Cinder RWO', requiredSequence: ['T2 complete', 'rightsizing', 'constraints reconciled', 'verified two-node step', 'one-node test'] },
  },
  reporting: {
    timezone: 'America/Toronto', start: null,
    startDefinition: 'real preceding invoice/report boundary', startVerified: false,
    requestedEndExclusive: '2026-09-14T00:00:00-04:00',
    captureCutoffs: { architectureRuntime: '2026-09-13T15:38:00Z', transitionImplementation: '2026-09-13T15:39:00Z', latestTransitionAudit: null, unifiedDeliveryTokenBilling: null },
    captureCutoffStatus: 'Follow-up transition evidence is dated September 13 without an exact UTC cutoff; unified delivery/token/billing cutoff not frozen',
    september13Transitions: 'inside requested period; classify observed versus planned',
  },
  billing: {
    position: 'last-annex', allocationMethodChoiceRequired: false,
    node: { quantity: 1, sku: 'b3-8', region: 'BHS5', hourlyRateCad: 0.082, periodHours: null, projectedAmountCad: null },
    historicalIllustrationOnly: { hours: 720, projectedAmountCad: 59.04, currentPeriodAmount: false },
    llm: { tariffRule: 'same unit tariffs as previous month actual invoice', previousInvoiceIdentity: null, previousInvoiceVerified: false, tokenCountStatus: 'not parsed in D5 docs build' },
  },
};

export function responsePack(manifest, note, remarks, capturedAt) {
  return { schema: 'immo-focus-owner-instructions/v3', dossier: 'immo-target-transitions-and-reporting', revision: 'D5',
    dossierHash: manifest.dossierHash, artifactInputHash: manifest.artifactInputHash, capturedAt,
    buildOnly: true, status: 'owner-correction-recorded; period-and-billing-evidence-incomplete',
    authority: 'instructions captured; no deployment, invoice or Track decision emitted',
    ownerCorrection, fixedInstructions, unresolvedEvidence: [
      'preceding actual invoice/report boundary and corresponding period start',
      'unified September 13 delivery/token/billing data capture cutoff', 'previous month actual invoice identity and unit tariffs',
      'current-period node hours and projected amount', 'current-period token counts using the verified prior tariffs',
      'production private bindings and T1/T2/T3 acceptance evidence',
    ], note, remarks };
}
