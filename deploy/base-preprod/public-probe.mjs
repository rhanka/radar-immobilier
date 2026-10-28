// La première version reprend le comportement du get de la sonde du 28/10.
export function resolvePath(path, config) {
  return path.replaceAll(':workspaceId', encodeURIComponent(config.workspaceId))
    .replaceAll(':citySlug', encodeURIComponent(config.citySlug));
}
export async function readCheck(checks, spec, config, fetchRequest = fetch) {
  const path = resolvePath(spec.path, config);
  try {
    const r = await fetchRequest(path, { credentials: spec.credentials ?? 'include', cache: 'no-store', signal: AbortSignal.timeout(12000) });
    const b = await r.json().catch(() => ({}));
    const scoped = path.startsWith(`/api/v1/workspaces/${config.workspaceId}/`) && spec.expected === 200;
    const privateNoStore = r.headers.get('cache-control')?.includes('no-store') === true
      && r.headers.get('vary')?.toLowerCase().includes('cookie') === true;
    checks.push({ name: spec.name, status: r.status, expected: spec.expected,
      passed: r.status === spec.expected && (!scoped || privateNoStore),
      privateNoStore: scoped ? privateNoStore : undefined, error: typeof b.error === 'string' ? b.error : null });
    return b;
  } catch (e) {
    checks.push({ name: spec.name, status: 0, expected: spec.expected, passed: false, transportError: e.name });
    return {};
  }
}
