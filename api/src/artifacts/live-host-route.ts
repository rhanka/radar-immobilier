import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { HOST_BUILD_PATHS, HOST_HANDOFF_BODY_MAX_BYTES, HOST_JOB_BODY_MAX_BYTES, type LiveHostEndpoints } from "@radar/artifacts-host";

/**
 * Inbound SG4b host build API for the Sentropic builder (W7), mounted under
 * `/api/v1/artifacts` (preprod host base https://preprod.immo.sent-tech.ca/api/v1/artifacts).
 * Server-to-server: authenticated by the builder's Ed25519 signature inside
 * the body (verified by the provider live-host code), never by a session or
 * a bearer token. Mounted only when the git mode stage selects
 * `artifacts_git_publish`; with the flag off the paths do not exist.
 */
export function liveHostRoute(endpoints: LiveHostEndpoints): Hono {
  const app = new Hono();
  app.use("*", async (c, next) => {
    await next();
    c.header("cache-control", "no-store");
    c.header("x-content-type-options", "nosniff");
  });
  const parse = async (raw: string): Promise<unknown> => {
    try { return JSON.parse(raw); } catch { return undefined; }
  };
  const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), {
    status: status as ContentfulStatusCode, headers: { "content-type": "application/json" } });
  const tooLarge = () => answer(413, { v: 1, error: "request_invalid" });
  app.post(HOST_BUILD_PATHS.job, bodyLimit({ maxSize: HOST_JOB_BODY_MAX_BYTES, onError: tooLarge }), async (c) => {
    const response = await endpoints.job(await parse(await c.req.text()));
    return answer(response.status, response.body);
  });
  app.post(HOST_BUILD_PATHS.handoff, bodyLimit({ maxSize: HOST_HANDOFF_BODY_MAX_BYTES, onError: tooLarge }), async (c) => {
    const response = await endpoints.handoff(await parse(await c.req.text()));
    return answer(response.status, response.body);
  });
  return app;
}
