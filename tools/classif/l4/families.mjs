// Seat-family parallelism for L4 (dev + blind): routes sharing a seat backend run
// sequentially (per-seat limit of 2 concurrent calls unchanged), families run in
// parallel. Grouping is by route prefix: muse (muse-spark-*), claude (opus-*),
// vibe (mistral-*, glm-*), agy (gemini-*), codex (sol-*, luna-*: the ChatGPT low seats, one
// ChatGPT seat backend, so they run sequentially; sol is the GEPA one). Unknown prefixes get their own family
// so a new route never shares a seat budget with an unrelated backend.
export const SEAT_FAMILY_ORDER = ['muse', 'claude', 'vibe', 'agy'];

/** Seat family of one evaluated route. Exported for the parallel tests. */
export function seatFamily(route) {
  if (route.startsWith('muse-')) return 'muse';
  if (route.startsWith('opus-')) return 'claude';
  if (route.startsWith('mistral-') || route.startsWith('glm-')) return 'vibe';
  if (route.startsWith('gemini-')) return 'agy';
  if (route.startsWith('sol-') || route.startsWith('luna-')) return 'codex';
  return 'other';
}

/**
 * Group routes by seat family, preserving the input order inside each family.
 * Families are ordered muse, claude, vibe, agy, then any other family in order
 * of first appearance. Exported for the parallel tests.
 */
export function groupRoutesByFamily(routes) {
  const byFamily = new Map();
  for (const route of routes) {
    const family = seatFamily(route);
    if (!byFamily.has(family)) byFamily.set(family, []);
    byFamily.get(family).push(route);
  }
  const groups = [...byFamily.entries()].map(([family, famRoutes]) => ({ family, routes: [...famRoutes] }));
  const rank = (family) => {
    const i = SEAT_FAMILY_ORDER.indexOf(family);
    return i === -1 ? SEAT_FAMILY_ORDER.length : i;
  };
  groups.sort((a, b) => {
    const ra = rank(a.family);
    const rb = rank(b.family);
    if (ra !== rb) return ra - rb;
    return routes.indexOf(a.routes[0]) - routes.indexOf(b.routes[0]);
  });
  return groups;
}

/**
 * Run one async task per route with family-level parallelism: families run in
 * parallel, routes inside one family run sequentially in input order. Every
 * family settles before the call returns: a rejected family does not cancel the
 * others (their per-item caches and per-route files are already on disk), the
 * first rejection is rethrown after all families settle. Returns a Map of
 * route -> result.
 */
export async function runFamiliesParallel(families, runRoute) {
  const settled = await Promise.all(families.map(async (fam) => {
    const out = [];
    try {
      for (const route of fam.routes) {
        out.push({ route, result: await runRoute(route, fam.family) });
      }
      return { family: fam.family, out, status: 'fulfilled' };
    } catch (reason) {
      return { family: fam.family, out, status: 'rejected', reason };
    }
  }));
  const failed = settled.find((s) => s.status === 'rejected');
  if (failed) throw failed.reason;
  const byRoute = new Map();
  for (const s of settled) {
    for (const { route, result } of s.out) byRoute.set(route, result);
  }
  return byRoute;
}
