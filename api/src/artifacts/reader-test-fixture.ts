/** Synthetic ports for module tests; never imported by the runtime. */
import { createReaderContentApp, type ContentServeDeps } from "./content-serve.js";
import { createFixtureAuthority } from "./reader-profile.js";
import { syntheticGeoItems, syntheticSignals } from "./reader-operations.js";
import { mintSessionCookie } from "./preview-session.js";

export function fixtureReaderDeps(): Pick<ContentServeDeps, "authority" | "readOperation"> {
  return {
    authority: createFixtureAuthority(),
    readOperation: async (op, params, context) => {
      if (op === "geo.read.v1") {
        const { collectionId, limit } = params as { collectionId: string; limit: number };
        return { type: "FeatureCollection", features: syntheticGeoItems(collectionId, limit) };
      }
      const { city } = params as { city: string };
      return { city, reader: context.readerSub, signals: syntheticSignals(city, context.readerSub) };
    },
  };
}

export const GRANT_SECRET = "grant-secret-32-bytes-long-padding!";
export const SESSION_SECRET = "session-secret-32-bytes-long-pad!!";
export const ISSUER = { issuer: "https://api.example.test", audience: "https://api.example.test/reader", tier: "preprod" };
export const HOST = "123e4567-e89b-12d3-a456-426614174000.pages.example.test";

export function makeApp(now: () => number = () => 1_000) {
  return createReaderContentApp({ ...fixtureReaderDeps(), contentBase: "pages.example.test",
    grantSecret: GRANT_SECRET, sessionSecret: SESSION_SECRET, issuer: ISSUER, now });
}

export async function credentials(readerSub: string, sessionId: string, nowMs: number): Promise<string> {
  return mintSessionCookie({ sid: sessionId, readerSub,
    artifactId: "123e4567-e89b-12d3-a456-426614174000", createdAt: nowMs, expiresAt: nowMs + 900_000 },
  SESSION_SECRET).split(";")[0]!;
}

export async function request(app: ReturnType<typeof makeApp>, path: string, cookie?: string, grant?: string): Promise<Response> {
  const url = `http://${HOST}${path}${grant ? `${path.includes("?") ? "&" : "?"}grant=${grant}` : ""}`;
  return app.request(url, { headers: { host: HOST, ...(cookie ? { cookie } : {}) } });
}
