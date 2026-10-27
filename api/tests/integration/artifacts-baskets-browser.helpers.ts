import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { RequestListener } from "node:http";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Real HTTPS redirects and Secure cookies, without external DNS or fixed ports. */
export async function startBrowserHttps(listener: RequestListener) {
  const directory = mkdtempSync(join(tmpdir(), "artifacts-browser-"));
  let server: Server | undefined;
  const close = async () => {
    try {
      if (server?.listening) await new Promise<void>((resolve, reject) => {
        server!.close((error) => error ? reject(error) : resolve());
        server!.closeAllConnections();
      });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  };
  try {
    const key = join(directory, "key.pem"), cert = join(directory, "cert.pem");
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
      "-subj", "/CN=app.example.test", "-addext", "subjectAltName=DNS:app.example.test,DNS:*.pages.example.test",
      "-keyout", key, "-out", cert], { stdio: "pipe" });
    server = createServer({ key: readFileSync(key), cert: readFileSync(cert) }, listener);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;
    return { close, args: ["--no-sandbox", "--no-proxy-server",
      `--host-resolver-rules=MAP *.pages.example.test 127.0.0.1:${port}, MAP app.example.test 127.0.0.1:${port}`] };
  } catch (error) { await close(); throw error; }
}
