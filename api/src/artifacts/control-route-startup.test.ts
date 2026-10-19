import { afterEach, describe, expect, it, vi } from "vitest";
import * as artifacts from "@radar/artifacts-host";
import { startArtifactControl } from "./control-route-startup.js";
import { createApp } from "../app.js";
import type { ObjectStore } from "../storage/object-store.js";
import type { AuthConfig } from "../config.js";
import type { Database } from "../db/client.js";
import { signSession } from "../services/auth/session.js";

const auth: AuthConfig = {
  enabled: true, issuer: "https://auth.example.test", clientId: "radar", clientSecret: "test-client",
  redirectUri: "https://app.example.test/api/v1/auth/oauth/callback", scopes: "openid",
  appBaseUrl: "https://app.example.test", sessionSecret: "test-session-secret-32-bytes-padding",
  sessionTtlSeconds: 3600, sessionAbsoluteTtlSeconds: 7200,
  jwksUri: "https://auth.example.test/jwks", bearerAudiences: ["https://app.example.test"],
};
async function cookie(sub: string) {
  return `radar_session=${await signSession({ sub }, { sessionSecret: auth.sessionSecret, ttlSeconds: 3600 })}`;
}

const input = { storageScope: "startup", orgId: "org", s3Bucket: "test-artifacts",
  s3Endpoint: "http://minio:9000", s3Region: "ca-central-1", s3AccessKey: "test", s3SecretKey: "test" };
const options = { input, auth, contentBase: "pages.example.test",
  poolParams: { host: "postgres", port: 5432, user: "test", password: "test", database: "test" },
  logger: { info: vi.fn(), error: vi.fn() } };
afterEach(() => vi.restoreAllMocks());

describe("artifact control startup", () => {
  it("exits only for malformed storage configuration before creating a pool", async () => {
    const pool = vi.spyOn(artifacts, "createArtifactsPool");
    const exit = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
    await expect(startArtifactControl({ ...options, input: { storageScope: "bad/scope" } })).rejects.toThrow("exit");
    expect(exit).toHaveBeenCalledWith(1);
    expect(pool).not.toHaveBeenCalled();
  });

  it("creates no pool or writes in open mode", async () => {
    const pool = vi.spyOn(artifacts, "createArtifactsPool");
    const compose = vi.spyOn(artifacts, "composeArtifactHost");
    expect(await startArtifactControl({ ...options, auth: { ...options.auth, enabled: false } })).toBeNull();
    expect(pool).not.toHaveBeenCalled();
    expect(compose).not.toHaveBeenCalled();
  });

  it.each(["connect ECONNREFUSED postgres:5432", "artifact schema unavailable: 0015 absent or hash mismatch",
    "artifact scope organization mismatch"])("keeps API live and control at 503 for %s", async (message) => {
    const query = vi.fn().mockRejectedValue(new Error("database unavailable"));
    const pool = { query } as unknown as ReturnType<typeof artifacts.createArtifactsPool>;
    vi.spyOn(artifacts, "createArtifactsPool").mockReturnValue(pool);
    const cause = new Error(message);
    vi.spyOn(artifacts, "composeArtifactHost").mockRejectedValue(cause);
    const exit = vi.spyOn(process, "exit");
    const deps = await startArtifactControl(options);
    expect(deps).toEqual({ auth: options.auth, accounts: pool });
    const app = createApp({ auth, artifactsControl: deps!, store: {} as ObjectStore, db: {} as Database,
      checkDb: async () => ({ ok: true }), checkObjectStore: async () => ({ ok: true }) });
    const response = await app.request("https://app.example.test/api/v1/artifacts/control/list", {
      headers: { cookie: await cookie("alice") } });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "capability_unavailable" });
    expect((await app.request("https://app.example.test/livez")).status).toBe(200);
    expect(options.logger.error).toHaveBeenCalledWith({ err: cause }, expect.stringContaining("API remains available"));
    expect(pool.query).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });
});
