/**
 * Standalone content-reader listener (ARTEFACTS A6/H5 runtime).
 *
 * Serves ONLY the authorized reader application: no config module beyond
 * the H5 technical references, no database, no object store beyond the
 * technical fixture path, no authentication session and no credential is
 * loaded. Listens on PORT (default 3000); an invalid PORT fails fast.
 * Bundled into the final API image; dispatched only via the explicit
 * `content-reader` entrypoint mode.
 */
import { createServer } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { createReaderContentApp } from "./content-serve.js";

const REQUIRED = ["ARTIFACTS_CONTENT_BASE", "ARTIFACTS_READER_GRANT_SECRET", "ARTIFACTS_READER_SESSION_SECRET"] as const;

function requiredEnv(name: string): string {
  const value = (process.env[name] ?? "").trim();
  if (value === "") throw new Error(`[content-reader] refused: missing ${name}`);
  return value;
}

function resolvePort(): number {
  const raw = process.env.PORT ?? "3000";
  const port = Number(raw.trim());
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`[content-reader] refused: invalid PORT ${JSON.stringify(raw)}`);
  }
  return port;
}

function resolveIssuer(): { issuer: string; audience: string; tier: string } {
  return {
    issuer: (process.env.ARTIFACTS_READER_ISSUER ?? "https://api.example.test").trim(),
    audience: (process.env.ARTIFACTS_READER_AUDIENCE ?? "https://api.example.test/reader").trim(),
    tier: (process.env.ARTIFACTS_READER_TIER ?? "preprod").trim(),
  };
}

const app = createReaderContentApp({
  contentBase: requiredEnv(REQUIRED[0]),
  grantSecret: requiredEnv(REQUIRED[1]),
  sessionSecret: requiredEnv(REQUIRED[2]),
  issuer: resolveIssuer(),
});

const listener = getRequestListener(app.fetch);
createServer((req, res) => {
  req.headers.host = req.headers.host ?? "content-reader.invalid";
  return listener(req, res);
}).listen(resolvePort(), () => {
  console.log("content-reader listening");
});
