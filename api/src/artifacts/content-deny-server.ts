import { createServer } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { createContentDenyApp } from "./content-deny.js";

/**
 * Standalone denial listener entrypoint (861c lot H3 unit 8). Serves ONLY
 * the unconditional denial application: no config module, no database, no
 * object store, no authentication, no session and no credential is loaded.
 * Listens on PORT (default 3000); an invalid PORT fails fast.
 */
function resolvePort(): number {
  const raw = process.env.PORT;
  const port = Number((raw ?? "3000").trim());
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `invalid PORT ${JSON.stringify(raw)}: expected an integer in 1-65535`,
    );
  }
  return port;
}

const port = resolvePort();

const listener = getRequestListener(createContentDenyApp().fetch);
createServer((req, res) => {
  // No Host routing or authorization: malformed names get the same denial.
  req.headers.host = "content-deny.invalid";
  return listener(req, res);
}).listen(port, () => {
  console.log(`content-deny listening on port ${port}`);
});
