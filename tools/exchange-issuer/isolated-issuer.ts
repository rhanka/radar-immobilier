import { Hono } from "hono";
import { exportJWK, generateKeyPair, jwtVerify, SignJWT, type KeyLike } from "jose";

/** Synthetic issuer only: verifies subjects; never accepts arbitrary decoded claims. */
export async function createIsolatedIssuer(options: {
  issuer: string; resource: string; audience: string; subjectKey: KeyLike; workload: string;
}) {
  const pair = await generateKeyPair("RS256");
  const jwk = await exportJWK(pair.publicKey);
  const app = new Hono();
  const issued: string[] = [];
  app.get("/.well-known/jwks.json", (c) => c.json({ keys: [
    { ...jwk, kid: "synthetic-p4", alg: "RS256", use: "sig" },
  ] }));
  app.post("/token", async (c) => {
    const form = new URLSearchParams(await c.req.text());
    if (form.get("grant_type") !== "urn:ietf:params:oauth:grant-type:token-exchange" ||
        form.get("subject_token_type") !== "urn:ietf:params:oauth:token-type:access_token" ||
        form.get("requested_token_type") !== "urn:ietf:params:oauth:token-type:access_token" ||
        form.get("audience") !== options.audience || form.get("scope") !== "immo:search") {
      return c.json({ error: "invalid_request" }, 400);
    }
    try {
      const { payload } = await jwtVerify(form.get("subject_token") ?? "", options.subjectKey, {
        issuer: options.issuer, audience: options.resource, algorithms: ["RS256"],
      });
      const now = Math.floor(Date.now() / 1000);
      if (!payload.sub || !payload.exp || !String(payload.scope).split(" ").includes("immo:search")) {
        return c.json({ error: "invalid_grant" }, 400);
      }
      const exp = Math.min(now + 60, payload.exp);
      const token = await new SignJWT({ scope: "immo:search", client_id: options.workload,
        act: { sub: options.workload } })
        .setProtectedHeader({ alg: "RS256", typ: "at+jwt", kid: "synthetic-p4" })
        .setIssuer(options.issuer).setAudience(options.audience).setSubject(payload.sub)
        .setIssuedAt(now).setExpirationTime(exp).setJti(`synthetic-${issued.length + 1}`)
        .sign(pair.privateKey);
      issued.push(token);
      return c.json({ access_token: token, token_type: "Bearer", expires_in: exp - now,
        scope: "immo:search", issued_token_type: "urn:ietf:params:oauth:token-type:access_token" });
    } catch { return c.json({ error: "invalid_grant" }, 400); }
  });
  return { app, issued, publicKey: pair.publicKey };
}
