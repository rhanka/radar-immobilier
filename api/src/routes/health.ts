import { Hono } from "hono";

/** Result of a single dependency health probe. */
export interface ProbeResult {
  ok: boolean;
  detail?: string;
}

export type HealthProbe = () => Promise<ProbeResult>;

export interface HealthDeps {
  checkDb: HealthProbe;
  checkObjectStore: HealthProbe;
}

/**
 * Builds the /health route. Dependencies are injected so the route can be
 * unit-tested without a real DB or object store, and so Lots 3/4 can wire
 * the real probes without touching this file.
 */
export function healthRoute(deps: HealthDeps): Hono {
  const app = new Hono();

  app.get("/health", async (c) => {
    const [db, objectStore] = await Promise.all([
      deps.checkDb().catch((e): ProbeResult => ({ ok: false, detail: String(e) })),
      deps
        .checkObjectStore()
        .catch((e): ProbeResult => ({ ok: false, detail: String(e) })),
    ]);

    const ok = db.ok && objectStore.ok;
    return c.json(
      {
        status: ok ? "ok" : "degraded",
        db,
        objectStore,
      },
      ok ? 200 : 503,
    );
  });

  return app;
}
