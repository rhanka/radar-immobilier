import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { it, expect } from 'vitest';
import { expect as browserExpect } from '@playwright/test';
import { Hono } from 'hono';
import { dedicatedCdpPage } from '../../../ui/e2e-qa/url-filters-cdp.mjs';
import { openPerimeter } from '../../../ui/e2e-qa/signals-perimeter-fixture';
import { revisionFixture } from '../../src/services/facets/projection-revisions-fixture';
import { graphNodes } from '../../src/db/schema';
import { targetFingerprint } from '../../src/services/facets/target';
import { writeScopedPersonalFacet } from '../../src/services/facets/scoped-writer';
import { writeWorkspaceArchiveFacet } from '../../src/services/facets/workspace-writer';
import { scopedProjectionRevisionsRoute } from '../../src/routes/scoped-projection-revisions';
import { scopedSignalFacetsRoute } from '../../src/routes/scoped-signal-facets';
import { scopedWorkspaceArchiveRoute } from '../../src/routes/scoped-workspace-archive';

for (const scenario of ['personal', 'workspace', 'both', 'refused', 'changed', 'lost-response', 'lost-all-replies', 'network', 'rejected', 'shared-head-conflict', 'selection-conflict'] as const) {
  const fault = ['changed', 'lost-response', 'lost-all-replies', 'network', 'rejected', 'shared-head-conflict', 'selection-conflict'].includes(scenario);
  const kind = fault ? 'both' : scenario;
  const rejected = ['changed', 'rejected', 'shared-head-conflict', 'selection-conflict'].includes(scenario);
  it.skipIf(process.env.QA_CDP_URL !== 'http://127.0.0.1:9333' || process.env.LOT_MIGRATION_DB_TEST !== '1')(`should handle ${scenario} archives through real clicks, routes and PostgreSQL`, async () => {
    const f = await revisionFixture();
    const [node] = await f.db.insert(graphNodes).values({ id: randomUUID(), type: 'Signal', citySlug: 'delson',
      label: 'Projet de règlement de zonage résidentiel multifamilial',
      props: { refs: [{ publishedAt: '2026-03-30' }] } }).returning();
    const target = { citySlug: 'delson', type: 'Signal' as const, id: node!.id };
    const command = { action: 'discard' as const, target, expectedHeadId: null,
      displayedFingerprint: targetFingerprint(node!), reasonCode: 'N-NON-RES', commandKey: randomUUID() };
    // Seed as moderator; the refused case reads as a contributor.
    if (kind === 'personal' || kind === 'both') await writeScopedPersonalFacet(f.db, f.moderator.sub, f.workspaceId, command);
    if (kind !== 'personal') await writeWorkspaceArchiveFacet(f.db, f.moderator.sub, f.workspaceId, { ...command, commandKey: randomUUID() });
    if (scenario === 'changed') {
      // Inject a refresh AFTER the first restore statement. On the old client it
      // commits with that POST; in the atomic command the later 409 rolls it back.
      await f.db.execute(sql`CREATE FUNCTION synthetic_refresh_on_restore() RETURNS trigger AS $$
        BEGIN
          IF NEW.scope = 'personal' AND NEW.facet = 'archive' AND NEW.state = 'inactive' THEN
            UPDATE graph_nodes SET label = 'Concurrent refresh'
              WHERE city_slug = NEW.city_slug AND id = NEW.node_id;
          END IF;
          RETURN NEW;
        END; $$ LANGUAGE plpgsql`);
      await f.db.execute(sql`CREATE TRIGGER synthetic_refresh_on_restore AFTER INSERT ON facet_events
        FOR EACH ROW EXECUTE FUNCTION synthetic_refresh_on_restore()`);
    }
    const app = new Hono();
    app.use('*', async (c, next) => { c.set('session' as never, { sub: kind === 'refused' ? f.contributor.sub : f.moderator.sub } as never); await next(); });
    app.route('/', scopedProjectionRevisionsRoute({ db: f.db, auth: { enabled: true } }));
    app.route('/', scopedSignalFacetsRoute({ db: f.db, auth: { enabled: true } }));
    app.route('/', scopedWorkspaceArchiveRoute({ db: f.db, auth: { enabled: true } }));
    const connection = await dedicatedCdpPage('http://127.0.0.1:9333');
    const diagnostics: string[] = [];
    connection.page.on('pageerror', error => diagnostics.push(error.message));
    connection.page.on('requestfailed', request => diagnostics.push(`${request.method()} ${new URL(request.url()).pathname}: ${request.failure()?.errorText}`));
    try {
      const page = connection.page;
      page.setDefaultTimeout(1800);
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.bringToFront();
      // Install mocks before booting once with the real workspace and DB routes.
      await openPerimeter(page, 'http://127.0.0.1:5407', false);
      await page.route('**/api/v1/workspaces', route => route.fulfill({ json: { ok: true, workspaces: [{ workspace: {
        id: f.workspaceId, slug: 'qa', label: 'QA' }, moderateArchive: kind !== 'refused', manageMembers: true }] } }));
      const writes: { path: string; status: number }[] = [];
      const keys: string[] = [];
      await page.route('**/signal-facets/**', async route => {
        const req = route.request();
        const url = new URL(req.url());
        if (!/\/(coherent-city|by-city)$/.test(url.pathname) && !/\/(personal|workspace)\//.test(url.pathname)) return route.fallback();
        const restoring = req.method() === 'POST' && /\/(restore|reclassify)$/.test(url.pathname);
        let body = req.postData();
        if (restoring) {
          keys.push(req.headers()['idempotency-key']!);
          if (scenario === 'rejected') {
            writes.push({ path: 'personal/reclassify', status: 503 });
            return route.fulfill({ status: 503, json: { error: 'synthetic_unavailable' } });
          }
          if (url.pathname.endsWith('/reclassify') && ['shared-head-conflict', 'selection-conflict'].includes(scenario)) {
            const command = JSON.parse(body!);
            if (scenario === 'shared-head-conflict') command.archives.workspace = randomUUID();
            else command.selectionHeads.pertinent = randomUUID();
            body = JSON.stringify(command);
          }
        }
        const response = await app.request(url.pathname + url.search, { method: req.method(), headers: req.headers(),
          ...(req.method() === 'POST' ? { body: body! } : {}) });
        if (!response.ok) diagnostics.push(`${url.pathname}: ${response.status}`);
        if (req.method() === 'POST') writes.push({ path: url.pathname.split('/signal-facets/')[1], status: response.status });
        if (restoring && response.ok && (url.pathname.endsWith('/workspace/restore') || url.pathname.endsWith('/reclassify'))
          && ((['lost-response', 'network'].includes(scenario)
            && (keys.length === 1 || url.pathname.endsWith('/workspace/restore'))) || scenario === 'lost-all-replies')) {
          writes[writes.length - 1]!.status = scenario === 'network' ? 0 : 502;
          if (scenario === 'network') return route.abort('failed');
          return route.fulfill({ status: 502, json: { error: 'synthetic_response_lost_after_commit' } });
        }
        await route.fulfill({ status: response.status, headers: { 'content-type': 'application/json' }, body: await response.text() });
      });
      await page.goto('http://127.0.0.1:5407/geo/region/quebec?mode=signal&filter.zonage=0&filter.residentiel=0&filter.precoce=0&filter.excludePiia=0&filter.excludeDerogations=0');
      await browserExpect(page.locator('.rail-count-strong').first()).toHaveText('0', { timeout: 1800 });
      await page.getByTestId('classement-filter-trigger').click();
      await page.getByRole('checkbox', { name: 'Écarté', exact: true }).check();
      await page.getByTestId('classement-filter-trigger').click();
      await browserExpect(page.locator('.rail-count-strong').first()).toHaveText('1', { timeout: 1800 });
      await page.getByTestId('filtre-trigger').click();
      const beforeCounts = await page.getByTestId('filtre-panel').locator('.classement-row .st-badge').allTextContents();
      await page.getByTestId('filtre-trigger').click();
      await page.locator('button.rail-city-row', { hasText: 'Delson' }).click();
      await page.getByTestId('signals-bucket-head').click();
      const card = page.locator('[data-signal-node]', { hasText: node!.label! });
      await browserExpect(card).toBeVisible({ timeout: 1800 });
      await browserExpect(page.locator('.rail-count-strong').first()).toHaveText('1', { timeout: 1800 });
      await page.getByTestId('filtre-trigger').click();
      await browserExpect(page.getByTestId('filtre-panel').locator('.classement-row .st-badge')).toHaveText(beforeCounts, { timeout: 1800 });
      await page.getByTestId('filtre-trigger').click();
      await card.getByRole('button', { name: 'Classement : Écarté', exact: true }).click();
      if (kind === 'refused') {
        for (const name of ['Non classé', 'Pertinent', 'À surveiller']) {
          await browserExpect(page.getByRole('menuitem', { name, exact: true })).toBeDisabled();
        }
        await browserExpect(page.getByText('Archive partagée : seul un modérateur peut restaurer ce signal.', { exact: true })).toBeVisible();
        expect(writes).toEqual([]);
        return;
      }
      await page.getByRole('menuitem', { name: 'Non classé', exact: true }).click();
      await browserExpect(page.getByTestId('signal-classement-button').first()).toBeEnabled({ timeout: 1800 });
      const read = await app.request(`/api/v1/workspaces/${f.workspaceId}/signal-facets/coherent-city?citySlug=delson&mode=signal&showDiscarded=1`);
      const heads = (await read.json()).heads.find((head: { target: { id: string } }) => head.target.id === target.id);
      console.log('ATOMIC_RESTORE', scenario, JSON.stringify({ writes, heads }));
      for (const scope of kind === 'both' ? ['personal', 'workspace'] : [kind]) {
        expect(heads[scope].state).toBe(rejected ? 'active' : 'inactive');
      }
      const other = new Hono();
      other.use('*', async (c, next) => { c.set('session' as never, { sub: f.contributor.sub } as never); await next(); });
      other.route('/', scopedProjectionRevisionsRoute({ db: f.db, auth: { enabled: true } }));
      const otherRead = await other.request(`/api/v1/workspaces/${f.workspaceId}/signal-facets/coherent-city?citySlug=delson&mode=signal`);
      expect((await otherRead.json()).signals.map((signal: { id: string }) => signal.id))
        .toEqual(rejected ? [] : [target.id]);
      expect(writes.every(write => write.path === 'personal/reclassify')).toBe(true);
      expect(new Set(keys).size).toBe(1);
      await browserExpect(page.locator('[data-signal-node]').getByRole('button', {
        name: rejected ? 'Classement : Écarté' : 'Classement : Non classé', exact: true,
      })).toBeVisible({ timeout: 1800 });
      if (rejected) {
        await page.getByTestId('classement-error-icon').click();
        await browserExpect(page.getByText(scenario === 'rejected'
          ? 'Résultat du classement à vérifier. Rechargez les données pour connaître son état.'
          : /Classement non enregistré/).first()).toBeVisible({ timeout: 1800 });
        await page.reload();
        await page.getByTestId('classement-filter-trigger').click();
        await page.getByRole('checkbox', { name: 'Écarté', exact: true }).check();
        await page.getByTestId('classement-filter-trigger').click();
        await page.locator('button.rail-city-row', { hasText: 'Delson' }).click();
        await page.getByTestId('signals-bucket-head').click();
        await browserExpect(page.getByRole('button', { name: 'Classement : Écarté', exact: true })).toBeVisible({ timeout: 1800 });
        return;
      }
      await browserExpect(page.getByText(/Classement non enregistré|Résultat du classement à vérifier/)).toHaveCount(0);
      await browserExpect(card.getByRole('button', { name: 'Classement : Non classé', exact: true })).toBeVisible({ timeout: 1800 });
      await page.getByTestId('classement-filter-trigger').click();
      await page.getByRole('checkbox', { name: 'Écarté', exact: true }).uncheck();
      await page.getByTestId('classement-filter-trigger').click();
      await browserExpect(card).toBeVisible();
      await page.reload();
      await page.locator('button.rail-city-row', { hasText: 'Delson' }).click();
      await page.getByTestId('signals-bucket-head').click();
      await browserExpect(card.getByRole('button', { name: 'Classement : Non classé', exact: true })).toBeVisible({ timeout: 1800 });
    } catch (error) {
      console.log('BROWSER_FAILURE', scenario, JSON.stringify({ diagnostics,
        body: await connection.page.locator('body').innerText().catch(() => '<unavailable>') }));
      throw error;
    } finally { await connection.close(); }
  });
}
