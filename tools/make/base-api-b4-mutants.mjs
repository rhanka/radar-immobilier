// Every family targets an observable assertion in the integrated PostgreSQL composition.
const closure = 'tests/integration/base-api-mutation-closure.spec.ts';
const safety = 'src/services/facets/activation-maintenance-safety.ts';
const operator = 'src/scripts/base-api-personal-activation.ts';
const opening = 'src/services/facets/activation-open.ts';
const M = (id, source, testFile, title, edits) => ({ id, source, testFile, title, edits });
const invalid = (key) => 'should retain closed SQL and public state for invalid ' + key + ' evidence';
const coverage = (key) => 'checkCoverage(evidence["' + key + '"], instances, "maintenance_' + key + '_unconfirmed", nowMs, maxAgeMs);';
export default [
  M('readback-6k', 'src/services/facets/lots/lot-cutover-safety.ts',
    'tests/integration/base-api-activation.spec.ts',
    'should keep 503 when a reconciled head goes missing before resume',
    [['checkCutoverReadbackCoverage(parsed.map((target) => target.key), observed, expected);', 'void observed;']]),
  M('identity-6h', 'src/services/facets/activation-readback.ts',
    closure,
    'should reject constant-count owner corruption through protected resume',
    [['event.ownerId !== stream.ownerId', 'false']]),
  M('actor-reuse-6k', 'src/routes/scoped-lot-cutover-activation.ts',
    'tests/integration/base-api-cutover-bound.spec.ts',
    'should refuse cross-actor reuse of a statically injected qualified safety',
    [['assertCutoverSafetyBinding(safety, c.req.param("workspaceId"), session.sub);', 'void session.sub;']]),
  M('missing-adapter-6k', 'src/routes/scoped-lot-cutover-activation.ts',
    'tests/integration/base-api-cutover-bound.spec.ts',
    'should refuse a foreign proof while the bound moderator opens',
    [['deps = configuredCutoverDeps(deps);', 'void deps;']]),
  M('drain', safety, closure, invalid('drain'), [[coverage('drain'), 'void instances;']]),
  M('shutdown', safety, closure, invalid('shutdown'), [[coverage('shutdown'), 'void instances;']]),
  M('workspace-binding', safety, closure, invalid('workspaceId'), [['if (workspaceId.toLowerCase() !== bound.workspaceId.toLowerCase()) {', 'if (false) {']]),
  M('attempt-binding', safety, closure, invalid('maintenanceAttemptId'), [['if (maintenanceAttemptId !== bound.maintenanceAttemptId) throw new ScopeError(403, "maintenance_evidence_attempt_mismatch");', 'void maintenanceAttemptId;']]),
  M('release-binding', safety, closure, invalid('releaseId'), [['if (releaseId !== bound.releaseId) throw new ScopeError(403, "maintenance_evidence_release_mismatch");', 'void releaseId;']]),
  M('readback-noop', safety, closure, 'should reject seeded persisted corruption through real operator readback', [['await delegate.readback(workspaceId);', 'void workspaceId;']]),
  M('open-order', opening, closure, 'should keep durable and public barriers closed throughout scoped resume readback', [['await safety.readback(input.workspaceId);', 'await db.update(facetActivationState).set({ maintenanceBarrier: false }).where(eq(facetActivationState.workspaceId, input.workspaceId));\n  await safety.readback(input.workspaceId);']]),
  M('public-readback', 'src/services/facets/lots/lot-city.ts', 'src/services/facets/lots/lot-cutover-readback-db.test.ts', 'should read back internally while public city reads stay closed', [
    ['db: Database, sub: string, workspaceId: string, mode: LotMode, citySlug: string,', 'db: Database, sub: string, workspaceId: string, mode: LotMode, citySlug: string, publicOptions?: { readback?: boolean },'],
    ['await requireOpenLotDestination(tx, workspaceId);', 'if (publicOptions?.readback !== true) await requireOpenLotDestination(tx, workspaceId);'],
  ]),
  M('resume-authority', opening, closure, 'should recheck current manager authority after real readback before opening', [['await managingActorId(tx, input.workspaceId, input.actorSub);', 'void input.actorSub;']]),
  M('protected-resume', operator, closure, 'should keep durable and public barriers closed throughout scoped resume readback', [['if (!durable || durable.writerEpoch !== "scoped") {', 'if (!durable || durable.writerEpoch === "scoped") {']]),
  M('restart-default', 'src/services/facets/legacy-retirement.ts', closure, 'should retain durable 503 and 410 across app reconstruction', [['const rows = await db.select().from(facetActivationState);', 'await db.select().from(facetActivationState); const rows = [];']]),
  M('writer-coverage', 'src/services/facets/lots/lot-cutover-gate.ts', 'src/services/facets/lots/lot-cutover-empty-prerequisites-db.test.ts', 'should reject empty activation without coverage', [['gate.reasons.push(`source_writers_uncovered:${uncovered.join(",")}`);', 'void uncovered;']]),
];
