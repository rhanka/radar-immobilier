import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { createServer } from "node:https";
import { once } from "node:events";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { L5_DOMAIN } from "./l5-fixture.js";

/** Only the IdP is synthetic. All product HTTP is transparently proxied to
 * api/dist/index.js in the separately built runtime image, preserving headers.
 */
export async function imageNetwork(subjects: string[]) {
  const pair = await generateKeyPair("EdDSA"), kid = randomUUID();
  const jwks = { keys: [{ ...await exportJWK(pair.publicKey), alg: "EdDSA", kid }] };
  const codes = new Map<string, { nonce: string; challenge: string; sub: string }>();
  const issuer = L5_DOMAIN.identityIssuer, callback = `${L5_DOMAIN.appOrigin}/api/v1/auth/oauth/callback`;
  const traffic: Array<{ host: string; path: string; method: string; site?: string; mode?: string;
    dest?: string; cookieNames: string[]; status: number; responseLost: boolean;
    isolation: { csp: string; coop: string; cache: string } }> = [];
  let exchanges = 0;
  let loseConfirm = false, lostResponses = 0;
  const server = createServer({ key: readFileSync("/tls/key.pem"), cert: readFileSync("/tls/cert.pem") }, async (req, res) => {
    try {
      const host = req.headers.host ?? "", url = new URL(req.url ?? "/", `https://${host}`);
      if (host === new URL(issuer).host) {
        const json = (body: unknown) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(body)); };
        if (url.pathname === "/.well-known/openid-configuration") return json({ issuer,
          authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` });
        if (url.pathname === "/jwks") return json(jwks);
        if (url.pathname === "/authorize") {
          assert.equal(url.searchParams.get("client_id"), L5_DOMAIN.clientId);
          assert.equal(url.searchParams.get("redirect_uri"), callback);
          assert.equal(url.searchParams.get("code_challenge_method"), "S256");
          const reader = url.searchParams.get("reader");
          if (reader === null) {
            res.setHeader("Content-Type", "text/html");
            const fields = [...url.searchParams].map(([name, value]) => `<input type="hidden" name="${name}" value="${value}">`).join("");
            return res.end(`<form>${fields}<button name="reader" value="0">Reader A</button><button name="reader" value="1">Reader B</button></form>`);
          }
          assert.ok(reader === "0" || reader === "1");
          const code = randomUUID();
          codes.set(code, { sub: subjects[Number(reader)]!, nonce: url.searchParams.get("nonce")!, challenge: url.searchParams.get("code_challenge")! });
          const redirect = new URL(callback); redirect.searchParams.set("code", code);
          redirect.searchParams.set("state", url.searchParams.get("state")!);
          res.writeHead(302, { location: redirect.href }); return res.end();
        }
        if (url.pathname === "/token") {
          assert.equal(req.method, "POST");
          assert.equal(req.headers.authorization, `Basic ${Buffer.from(`${L5_DOMAIN.clientId}:synthetic-client-secret`).toString("base64")}`);
          let raw = ""; for await (const chunk of req) raw += chunk;
          const body = new URLSearchParams(raw), code = body.get("code") ?? "", record = codes.get(code);
          assert.ok(record); codes.delete(code);
          assert.equal(body.get("grant_type"), "authorization_code"); assert.equal(body.get("redirect_uri"), callback);
          assert.equal(createHash("sha256").update(body.get("code_verifier") ?? "").digest("base64url"), record.challenge);
          exchanges++;
          const id_token = await new SignJWT({ nonce: record.nonce }).setProtectedHeader({ alg: "EdDSA", kid })
            .setIssuer(issuer).setAudience(L5_DOMAIN.clientId).setSubject(record.sub)
            .setIssuedAt().setExpirationTime("5m").sign(pair.privateKey);
          return json({ id_token, access_token: "synthetic-unused", token_type: "Bearer" });
        }
        res.writeHead(404); return res.end();
      }
      const upstream = httpRequest({ hostname: "runtime", port: 3000, path: req.url, method: req.method,
        headers: req.headers }, (response) => {
        const field = (name: string) => typeof req.headers[name] === "string" ? req.headers[name] as string : undefined;
        const site = field("sec-fetch-site"), mode = field("sec-fetch-mode"), dest = field("sec-fetch-dest");
        const responseLost = loseConfirm && url.pathname.endsWith("/confirm") && response.statusCode === 200;
        traffic.push({ host, path: url.pathname, method: req.method ?? "GET", status: response.statusCode ?? 0,
          ...(site ? { site } : {}), ...(mode ? { mode } : {}), ...(dest ? { dest } : {}),
          responseLost, isolation: { csp: String(response.headers["content-security-policy"] ?? ""),
            coop: String(response.headers["cross-origin-opener-policy"] ?? ""),
            cache: String(response.headers["cache-control"] ?? "") },
          cookieNames: (req.headers.cookie ?? "").split(";").map((part) => part.trim().split("=")[0]!).filter(Boolean) });
        if (responseLost) {
          loseConfirm = false; lostResponses++;
          response.on("end", () => res.destroy()); response.resume(); return;
        }
        res.writeHead(response.statusCode ?? 502, response.headers); response.pipe(res);
      });
      upstream.on("error", () => { res.writeHead(502); res.end(); }); req.pipe(upstream);
    } catch { res.writeHead(500); res.end("Synthetic IdP protocol assertion failed"); }
  });
  server.listen(443, "0.0.0.0"); await once(server, "listening");
  return { traffic, exchanges: () => exchanges, lostResponses: () => lostResponses,
    loseNextConfirmResponse: () => { assert.equal(loseConfirm, false); loseConfirm = true; },
    close: async () => {
    await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); });
  } };
}
