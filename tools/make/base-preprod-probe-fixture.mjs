import { resolvePath } from '../../deploy/base-preprod/public-probe.mjs';
export const fixtureConfig = { phase: 'q1', workspaceId: '11111111-1111-4111-8111-111111111111',
  actorSub: 'opaque:fixture', citySlug: 'fixture-city', releaseSha: 'b'.repeat(40) };
export function fixtureFetch(config, cases, overrides = {}) {
  const bodies = {
    health: { sha: config.releaseSha },
    session: { authenticated: true, user: { sub: config.actorSub, status: 'approved' } },
    workspaces: { workspaces: [{ workspace: { id: config.workspaceId }, manageMembers: true }] },
    'personal-heads': { heads: [] }, 'archive-heads': { heads: [] },
    'coherent-city': { ok: true, signals: [], counts: { total: 0, visible: 0, hidden: 0, selected: 0 } },
    'projection-revisions': { ok: true, revisions: { personal: 0, workspace: 0, source: 1 }, token: 'sensitive-fixture-only' },
    'reason-codes': { codes: ['fixture-reason'] }, 'facet-context': { ok: true },
    'lots-stay-closed': { error: 'lot_cutover_closed' },
    'unauthenticated-workspaces': { error: 'unauthenticated' },
  };
  return async (path, options) => {
    const pathname = path.split('?')[0];
    const prefixes = config.exposedPrefixes ?? ['/health', '/api/v1/auth', '/api/v1/workspaces'];
    if (!prefixes.some(prefix => pathname === prefix || pathname.startsWith(prefix + '/'))) return Response.json({ error: 'fixture_route_closed' }, { status: 503 });
    const spec = cases.find(x => resolvePath(x.path, config) === path && (x.credentials ?? 'include') === options.credentials);
    if (!spec || options.method !== 'GET') throw new Error('Requête imprévue dans la fixture');
    const body = overrides[spec.name] ?? bodies[spec.name];
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: spec.expected,
      headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store', vary: 'Cookie, Authorization' } });
  };
}
