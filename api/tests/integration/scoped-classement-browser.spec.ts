import { randomUUID } from 'node:crypto';
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

for (const kind of ['personal', 'workspace', 'both', 'refused'] as const) {
  it.skipIf(process.env.QA_CDP_URL !== 'http://127.0.0.1:9333' || process.env.LOT_MIGRATION_DB_TEST !== '1')(`should handle ${kind} archives through real clicks, routes and PostgreSQL`, async () => {
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
    const app = new Hono();
    app.use('*', async (c, next) => { c.set('session' as never, { sub: kind === 'refused' ? f.contributor.sub : f.moderator.sub } as never); await next(); });
    app.route('/', scopedProjectionRevisionsRoute({ db: f.db, auth: { enabled: true } }));
    app.route('/', scopedSignalFacetsRoute({ db: f.db, auth: { enabled: true } }));
    app.route('/', scopedWorkspaceArchiveRoute({ db: f.db, auth: { enabled: true } }));
    const connection = await dedicatedCdpPage('http://127.0.0.1:9333');
    try {
      const page = connection.page;
      await page.setViewportSize({ width: 1440, height: 1000 });
      await openPerimeter(page, 'http://127.0.0.1:5407');
      await page.route('**/api/v1/workspaces', route => route.fulfill({ json: { ok: true, workspaces: [{ workspace: {
        id: f.workspaceId, slug: 'qa', label: 'QA' }, moderateArchive: kind !== 'refused', manageMembers: true }] } }));
      const writes: { path: string; status: number }[] = [];
      await page.route('**/signal-facets/**', async route => {
        const req = route.request();
        const url = new URL(req.url());
        if (!/\/(coherent-city|by-city)$/.test(url.pathname) && !/\/(personal|workspace)\//.test(url.pathname)) return route.fallback();
        const response = await app.request(url.pathname + url.search, { method: req.method(), headers: req.headers(),
          ...(req.method() === 'POST' ? { body: req.postData()! } : {}) });
        if (req.method() === 'POST') writes.push({ path: url.pathname.split('/signal-facets/')[1], status: response.status });
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
      const response = page.waitForResponse(r => kind === 'both'
        ? r.url().endsWith('/workspace/restore')
        : /\/(personal|workspace)\/restore$/.test(new URL(r.url()).pathname), { timeout: 1800 });
      await page.getByRole('menuitem', { name: 'Non classé', exact: true }).click();
      const restored = await response;
      expect(restored.url()).toContain(kind === 'personal' ? '/personal/restore' : '/workspace/restore');
      console.log(kind, 'restore HTTP', restored.status(), await restored.text());
      expect(restored.status()).toBe(200);
      await browserExpect(card.getByRole('button', { name: 'Classement : Non classé', exact: true })).toBeVisible({ timeout: 1800 });
      expect(writes).toEqual((kind === 'both' ? ['personal/restore', 'workspace/restore'] : [`${kind}/restore`])
        .map(path => ({ path, status: 200 })));
      await page.getByTestId('classement-filter-trigger').click();
      await page.getByRole('checkbox', { name: 'Écarté', exact: true }).uncheck();
      await page.getByTestId('classement-filter-trigger').click();
      await browserExpect(card).toBeVisible();
      await page.reload();
      await page.locator('button.rail-city-row', { hasText: 'Delson' }).click();
      await page.getByTestId('signals-bucket-head').click();
      await browserExpect(card.getByRole('button', { name: 'Classement : Non classé', exact: true })).toBeVisible({ timeout: 1800 });
    } finally { await connection.close(); }
  });
}
