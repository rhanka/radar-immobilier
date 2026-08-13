import { Hono } from "hono";

/**
 * Deployed build identity — the short git sha, injected at image build time
 * (api/Dockerfile `ARG GIT_SHA` → `ENV GIT_SHA`, fed by the CI build's
 * `--build-arg GIT_SHA=<sha>`). Surfaced on /livez and /health — the latter is
 * the ONLY api route the UI nginx reverse-proxies publicly, so the CD deploy
 * job can PROVE the rolled-out sha is actually SERVED over the public URL.
 * `kubectl rollout status` alone goes green even against a stale/wrong cluster.
 * Falls back to "unknown" for local/dev builds that don't pass the arg. Read
 * per request (env is fixed at container start) so it stays trivially testable.
 */
function deployedSha(): string {
  return process.env["GIT_SHA"] ?? "unknown";
}

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

  // Liveness — process-only, NO dependency probe. The k8s startupProbe and
  // livenessProbe hit THIS (not /health): a Postgres/S3 hiccup must NOT get
  // the pod killed (it only removes it from the LB via readiness on /health).
  // Coupling liveness to a dependency turns a dependency blip into an app
  // crash-loop (exit 137) — see docs/spec/reports/radar-api-memory-study-2026-07-02.md.
  app.get("/livez", (c) => c.json({ status: "ok", sha: deployedSha() }, 200));

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
        // Build identity travels on /health too — it is the ONLY API route the
        // UI nginx reverse-proxies publicly (`location = /health` →
        // radar-api/health), so the CD deploy job can read the SERVED sha from
        // https://<public-host>/health regardless of the db/objectStore status.
        sha: deployedSha(),
        db,
        objectStore,
      },
      ok ? 200 : 503,
    );
  });

  return app;
}
