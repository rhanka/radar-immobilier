import { Hono } from "hono";
import type { JWTVerifyGetKey } from "jose";
import type { Database } from "../../src/db/client.js";
import type { AuthConfig } from "../../src/config.js";
import { protect } from "../../src/routes/auth.js";
import { signalFacetsRoute } from "../../src/routes/signal-facets.js";
import { signSession } from "../../src/services/auth/session.js";
import { privateSignalResponse } from "../../src/services/facets/private-response.js";

export const facetAuth: AuthConfig = {
  enabled: true, issuer: "https://auth.example.test", clientId: "test-client",
  clientSecret: "test-only", redirectUri: "https://app.example.test/callback",
  scopes: "openid", appBaseUrl: "https://app.example.test",
  sessionSecret: "test-only-facet-session-signing-key", sessionTtlSeconds: 3600,
  sessionAbsoluteTtlSeconds: 7200, jwksUri: "https://auth.example.test/jwks",
  bearerAudiences: ["https://app.example.test"],
};
export function facetHttp(db: Database, auth = facetAuth, bearerGetKey?: JWTVerifyGetKey) {
  const app = new Hono();
  app.use("/api/v1/signal-facets/*", privateSignalResponse);
  app.use("*", protect(auth, { db, ...(bearerGetKey ? { bearerGetKey } : {}) }));
  app.route("/", signalFacetsRoute({ db, auth }));
  return app;
}
export async function facetCookie(sub: string) {
  return `radar_session=${await signSession({ sub }, { sessionSecret: facetAuth.sessionSecret, ttlSeconds: 3600 })}`;
}
