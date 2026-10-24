// B5 regressions are applied only to the disposable container sources.
const L = 'src/services/facets/lots/';
const T = 'tests/integration/base-api-';
const M = (id, source, suite, title, edits) => ({ id, source,
  testFile: T + suite + '.spec.ts', title, edits });
function receipt(kind) {
  const suffix = kind === 'single' ? '/commands' : '/commands/batch';
  const anchor = '        const status = await fetchAccountStatus(options.db, session.sub);';
  return { ...M('receipt-' + kind, 'src/routes/auth.ts', 'lot-replay-guards', '', [
    ['import { eq } from "drizzle-orm";', 'import { and, eq } from "drizzle-orm";'],
    [anchor, `        const key = c.req.header("idempotency-key");
        if (key && c.req.path.endsWith("${suffix}")) {
          const schema = await import("../db/schema.js");
          const [owner] = await options.db.select().from(schema.accountUsers).where(eq(schema.accountUsers.sub, session.sub));
          const [receipt] = await options.db.select().from(schema.facetCommands).where(and(
            eq(schema.facetCommands.ownerId, owner!.id), eq(schema.facetCommands.commandKey, key)));
          if (receipt) {
            const stored = receipt.result as { result?: unknown; batch?: unknown };
            return c.json({ ok: true, result: stored.result ?? stored.batch });
          }
        }
` + anchor],
  ]), titles: ['approval', 'membership', 'lot_select', 'lot_pipeline', 'lot_market']
    .map(right => `denies ${kind} recovery after revoking ${right}`) };
}
export default [
  M('mount', 'src/app.ts', 'lot-authority', 'supports verified bearer reads while rejecting bearer writes', [
    ['    app.route("/", scopedLotFacetsRoute({ ...lotDeps, requireCutover: true }));', '    void lotDeps;'],
  ]),
  receipt('single'), receipt('batch'),
  M('closed-single', L + 'lot-writer.ts', 'lot-closed-replays',
    'closes public reads and existing single and batch receipts without mutation', [
      ['const destination = await requireOpenLotDestination(tx, workspaceId);',
        'const destination = await requireLotDestination(tx, workspaceId);'],
      ['import { requireOpenLotDestination }', 'import { requireOpenLotDestination, requireLotDestination }'],
    ]),
  M('closed-batch', L + 'lot-batch.ts', 'lot-closed-replays',
    'closes public reads and existing single and batch receipts without mutation', [
      ['const destination = await requireOpenLotDestination(tx, workspaceId);',
        'const destination = await requireLotDestination(tx, workspaceId);'],
      ['import { requireOpenLotDestination }', 'import { requireOpenLotDestination, requireLotDestination }'],
    ]),
  M('moderation', L + 'lot-authorize.ts', 'lot-authority', 'keeps moderation and scope separation on writes', [
    ['case "discard":\n      if (scope === "workspace" && !rights.moderateArchive)', 'case "discard":\n      if (false)'],
  ]),
  M('head', L + 'lot-transition.ts', 'lot-concurrency', 'settles one winner when distinct commands race the same head', [
    ['} else if ((main.ref.headEventId ?? null) !== command.expected_head_id) {', '} else if (false) {'],
  ]),
  M('fingerprint', L + 'lot-writer.ts', 'lot-concurrency', 'conflicts on stale content fingerprints with the current version', [
    ['\n      || resolved.fingerprint !== command.displayed_version.fingerprint', ''],
  ]),
  M('atomicity', L + 'lot-batch.ts', 'lot-batches', 'rolls back batches with a late invalid member', [
    ['import { sql } from "drizzle-orm";', 'import { randomUUID } from "node:crypto";\nimport { writeLotFacet } from "./lot-writer.js";\nimport { sql } from "drizzle-orm";'],
    ['  const key = batch.command_key.toLowerCase();', `  for (const item of batch.items) {
    await writeLotFacet(db, sub, workspaceId, scope, { ...item,
      contract_version: "lot-facets-v1", command_key: randomUUID(), mode: batch.mode });
  }
  const key = batch.command_key.toLowerCase();`],
  ]),
  M('maximum', L + 'lot-batch.ts', 'lot-batches', 'commits and replays 500 targets with expected cardinalities', [
    ['batch.items.length > 500', 'batch.items.length > 499'],
  ]),
  M('false-empty', L + 'lot-cutover-gate.ts', 'cutover-readback', 'refuses unresolved-only activation without fabricating SQL or public state', [
    ['gate.ready.length === 0 && report.rows.length > 0', 'false'],
  ]),
  M('readback', L + 'lot-cutover-safety.ts', 'cutover-readback',
    'holds public 503 during persisted empty readback then accepts the first ordinary mark', [
      ['const seen = await readLotCutoverReadback(db, bound.actorSub, workspaceId, mode, city);',
        'const seen = { heads: [] };'],
    ]),
  M('legacy', 'src/services/facets/legacy-retirement.ts', 'cutover-acceptance',
    'retires legacy delivery as explicit 503 then 410 with a successor', [
      ['return 503;', 'return 404;'], ['return 410;', 'return 404;'],
    ]),
  M('artifact-mount', 'src/app.ts', 'independence', 'serves lot operations while artifact configuration stays absent', [
    ['    app.route("/", scopedLotFacetsRoute({ ...lotDeps, requireCutover: true }));',
      '    if (deps.artifactsControl) app.route("/", scopedLotFacetsRoute({ ...lotDeps, requireCutover: true }));'],
  ]),
  M('artifact-call', 'src/app.ts', 'independence', 'makes no artifact backend calls during successful base operations', [
    ['    app.route("/", scopedLotFacetsRoute({ ...lotDeps, requireCutover: true }));',
      '    app.use("/api/v1/workspaces/*", async (_c, next) => { await deps.artifactsControl?.backend?.handle({} as never); await next(); });\n    app.route("/", scopedLotFacetsRoute({ ...lotDeps, requireCutover: true }));'],
  ]),
];
