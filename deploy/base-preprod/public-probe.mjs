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
