import { Hono } from "hono";

import type { ObjectStore } from "../storage/object-store.js";
import {
  createJobsStore,
  type JobsStore,
} from "../services/pipeline/jobs-store.js";

export interface JobsDeps {
  store: ObjectStore;
}

/**
 * Builds the /api/jobs routes (T4 jobs console read-model).
 *
 *   GET /api/jobs      — list all pipeline-run jobs, newest first.
 *   GET /api/jobs/:id  — one job (full per-step detail).
 *
 * Jobs are produced by the pipeline executor when a CiblagePlan is run
 * (`POST /api/ciblage/:id/run`); this route only READS them. A `JobsStore` can be
 * injected for tests; production builds one over the injected ObjectStore.
 */
export function jobsRoute(deps: JobsDeps, injectedStore?: JobsStore): Hono {
  const app = new Hono();
  const store = injectedStore ?? createJobsStore(deps.store);

  app.get("/api/jobs", async (c) => {
    const jobs = await store.list();
    return c.json({ ok: true, jobs });
  });

  app.get("/api/jobs/:id", async (c) => {
    const job = await store.get(c.req.param("id"));
    if (!job) {
      return c.json({ ok: false, error: "not-found" }, 404);
    }
    return c.json({ ok: true, job });
  });

  return app;
}
