import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import type { AuthConfig } from "../../src/config.js";

/** Launch the actual API bin with synthetic authority and a disposable database. */
export async function startSearchEntrypoint(database: string, auth: AuthConfig, enabled: boolean) {
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => reservation.close((err) => err ? reject(err) : resolve()));
  const strict = auth.strict!;
  const image = `sha256:${"a".repeat(64)}`;
  const env: NodeJS.ProcessEnv = { ...process.env,
    NODE_ENV: "test", PORT: String(port), LOG_LEVEL: "info", POSTGRES_DB: database,
    SENTROPIC_IDP_ISSUER: auth.issuer, SENTROPIC_IDP_JWKS_URI: auth.jwksUri,
    SENTROPIC_OAUTH_CLIENT_ID: auth.clientId, SENTROPIC_OAUTH_CLIENT_SECRET: auth.clientSecret,
    SENTROPIC_OAUTH_REDIRECT_URI: auth.redirectUri, AUTH_CALLBACK_BASE_URL: auth.appBaseUrl,
    SESSION_SECRET: auth.sessionSecret,
    STRICT_RECEIVER_ARMED: "1", STRICT_RECEIVER_WORKLOAD_SUB: strict.workloadSub,
    STRICT_RECEIVER_WORKLOAD_CLIENT_ID: strict.workloadClientId,
    STRICT_RECEIVER_ENVIRONMENT: strict.environment,
    STRICT_RECEIVER_RECEIPT_ISSUER: auth.issuer, STRICT_RECEIVER_RECEIPT_API_AUDIENCE: strict.apiAudience,
    STRICT_RECEIVER_RECEIPT_WORKLOAD_SUB: strict.workloadSub,
    STRICT_RECEIVER_RECEIPT_WORKLOAD_CLIENT_ID: strict.workloadClientId,
    STRICT_RECEIVER_RECEIPT_ENVIRONMENT: strict.environment,
    STRICT_RECEIVER_RECEIPT_ROUTE_PROFILE: "mcp-signals-search.get.v1",
    STRICT_RECEIVER_RECEIPT_SCHEMA_REVISION: "scoped-signal-search.v1",
    STRICT_RECEIVER_RECEIPT_POLICY_REVISION: "a2base-search-v1",
    STRICT_RECEIVER_API_IMAGE: image, STRICT_RECEIVER_MCP_IMAGE: image,
    STRICT_RECEIVER_RECEIPT_API_IMAGE: image, STRICT_RECEIVER_RECEIPT_MCP_IMAGE: image,
  };
  delete env.MCP_SIGNAL_SEARCH_ENABLED;
  if (enabled) env.MCP_SIGNAL_SEARCH_ENABLED = "1";
  const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"],
  });
  const stopped = once(child, "exit");
  const close = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
    try { await stopped; } finally { clearTimeout(timer); }
  };
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("API startup did not listen")), 10_000);
      let output = "";
      child.stdout.on("data", (data) => {
        output = (output + String(data)).slice(-16384);
        if (output.includes('"msg":"radar-api listening"')) { clearTimeout(timer); resolve(); }
      });
      child.stderr.on("data", (data) => { output = (output + String(data)).slice(-16384); });
      child.once("error", (err) => { clearTimeout(timer); reject(err); });
      child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`API exited ${code}: ${output}`)); });
    });
    return { url: `http://127.0.0.1:${port}`, close };
  } catch (err) { await close(); throw err; }
}
