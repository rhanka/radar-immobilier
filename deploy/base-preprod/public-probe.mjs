// Contrôles HTTP sans export de corps, cookie, jeton ou message de parsing.
export function resolvePath(path, config) {
  return path.replaceAll(':workspaceId', encodeURIComponent(config.workspaceId))
    .replaceAll(':citySlug', encodeURIComponent(config.citySlug));
}
export async function readCheck(checks, spec, config, fetchRequest = fetch) {
  const path = resolvePath(spec.path, config);
  const row = { name: spec.name, path, method: 'GET', status: 0, expected: spec.expected, passed: false };
  let phase = 'configuration';
  try {
    if ((spec.method ?? 'GET') !== 'GET' || !path.startsWith('/') || path.startsWith('//') || path.includes('\\')) throw new TypeError();
    phase = 'fetch';
    const r = await fetchRequest(path, { method: 'GET', credentials: spec.credentials ?? 'include',
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(12000) });
    row.status = r.status;
    const mime = (r.headers.get('content-type') ?? '').split(';')[0].toLowerCase();
    row.contentType = ['application/json', 'application/problem+json', 'text/html', 'text/plain'].includes(mime) ? mime : 'other';
    row.redirected = r.redirected === true;
    const scoped = path.startsWith(`/api/v1/workspaces/${config.workspaceId}/`) && spec.expected === 200;
    row.privateNoStore = scoped ? r.headers.get('cache-control')?.includes('no-store') === true
      && r.headers.get('vary')?.toLowerCase().includes('cookie') === true : undefined;
    phase = 'redirect';
    if (row.redirected || r.type === 'opaqueredirect') throw new TypeError();
    phase = 'body-read';
    const text = await r.text();
    row.bodyChars = text.length;
    phase = 'content-type';
    if (!/^application\/(?:json|[a-z0-9.+-]+\+json)(?:;|$)/i.test(row.contentType)) throw new TypeError();
    phase = 'json-parse';
    const body = JSON.parse(text);
    phase = 'json-schema';
    if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new TypeError();
    row.error = ['unauthenticated', 'lot_cutover_closed', 'legacy_retired'].includes(body.error) ? body.error : null;
    row.passed = r.status === spec.expected && (!scoped || row.privateNoStore);
    if (!row.passed) row.failurePhase = r.status !== spec.expected ? 'http-status' : 'cache-policy';
    checks.push(row);
    return body;
  } catch (error) {
    row.failurePhase = phase;
    row.errorType = error.name;
    checks.push(row);
    return {};
  }
}

export async function publicQualification(config, cases, fetchRequest = fetch) {
  const checks = [], bodies = Object.create(null);
  const wanted = config.phase === 'preflight' ? new Set(['health', 'session', 'workspaces']) : null;
  for (const spec of cases) {
    if (wanted && !wanted.has(spec.name)) continue;
    bodies[spec.name] = await readCheck(checks, spec, config, fetchRequest);
    if (checks.at(-1)?.passed !== true) break;
    if (spec.name === 'session' && bodies.session.authenticated !== true) break;
  }
  const auth = bodies.session ?? {}, workspaces = bodies.workspaces?.workspaces;
  const access = Array.isArray(workspaces) ? workspaces.find(x => x.workspace?.id === config.workspaceId) : null;
  const identity = { authenticated: auth.authenticated === true, approved: auth.user?.status === 'approved',
    actorMatches: auth.user?.sub === config.actorSub, authDisabled: auth.authDisabled === true };
  const semantic = (name, passed) => {
    const row = checks.find(x => x.name === name);
    if (row) { row.semanticPassed = passed; if (!passed) { row.passed = false; row.failurePhase ??= 'response-schema'; } }
  };
  semantic('health', bodies.health?.sha === config.releaseSha);
  semantic('session', identity.authenticated && identity.approved && identity.actorMatches && !identity.authDisabled);
  semantic('workspaces', !!access && access.manageMembers === true);
  const personal = bodies['personal-heads'], archive = bodies['archive-heads'], coherent = bodies['coherent-city'];
  const counts = { personalHeads: Array.isArray(personal?.heads) ? personal.heads.length : null,
    archiveHeads: Array.isArray(archive?.heads) ? archive.heads.length : null,
    reasonCodes: Array.isArray(bodies['reason-codes']?.codes) ? bodies['reason-codes'].codes.length : null };
  const coherentMatches = coherent?.ok === true && Array.isArray(coherent.signals)
    && coherent.counts?.visible === coherent.signals.length
    && coherent.counts?.total === coherent.counts?.visible + coherent.counts?.hidden;
  const revisions = bodies['projection-revisions']?.revisions;
  const projectionRevisionReadable = bodies['projection-revisions']?.ok === true
    && ['personal', 'workspace', 'source'].every(key => Number.isInteger(revisions?.[key]) && revisions[key] >= 0);
  if (!wanted) {
    semantic('personal-heads', counts.personalHeads === 0);
    semantic('archive-heads', counts.archiveHeads === 0);
    semantic('coherent-city', coherentMatches);
    semantic('projection-revisions', projectionRevisionReadable);
    semantic('reason-codes', counts.reasonCodes > 0);
    semantic('facet-context', bodies['facet-context']?.ok === true);
    semantic('lots-stay-closed', bodies['lots-stay-closed']?.error === 'lot_cutover_closed');
  }
  return { passed: checks.length === (wanted ? wanted.size : cases.length) && checks.every(x => x.passed), identity,
    workspace: { matched: !!access, manageMembers: access?.manageMembers === true }, checks,
    counts, coherentMatches, projectionRevisionReadable, businessMutations: 0 };
}
