import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type RequestListener } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Exercise the deployed application's nginx locations behind the HTTPS fixture. */
export async function startApprovalProxy(listener: RequestListener) {
  const directory = mkdtempSync(join(tmpdir(), "artifacts-nginx-"));
  chmodSync(directory, 0o755);
  const backend = createServer(listener);
  let nginx: ChildProcess | undefined;
  const close = async () => {
    if (nginx?.exitCode === null) {
      const exited = once(nginx, "exit");
      nginx.kill("SIGTERM");
      await exited;
    }
    if (backend.listening) {
      const closed = new Promise<void>((resolve) => backend.close(() => resolve()));
      backend.closeAllConnections();
      await closed;
    }
    rmSync(directory, { recursive: true, force: true });
  };
  try {
    backend.listen(0, "127.0.0.1");
    await once(backend, "listening");
    const upstream = `http://127.0.0.1:${(backend.address() as AddressInfo).port}`;
    const reservation = createServer();
    reservation.listen(0, "127.0.0.1");
    await once(reservation, "listening");
    const port = (reservation.address() as AddressInfo).port;
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    const deployed = readFileSync(new URL("../../../deploy/overlays/preprod/nginx/default.conf", import.meta.url), "utf8")
      .replace("listen 8080;", `listen 127.0.0.1:${port};`)
      .replace("/usr/share/nginx/html", directory)
      .replaceAll("http://radar-api:3000", upstream)
      .replaceAll("http://geo-api.geo-preprod.svc.cluster.local", upstream);
    writeFileSync(join(directory, "index.html"), "<!doctype html><title>SPA fallback</title>");
    writeFileSync(join(directory, "nginx.conf"),
      `pid ${directory}/nginx.pid; error_log stderr notice; events {} http { include /etc/nginx/mime.types; access_log off; ${deployed} }`);
    nginx = spawn("nginx", ["-p", directory, "-c", "nginx.conf", "-g", "daemon off;"], { stdio: ["ignore", "ignore", "pipe"] });
    await new Promise<void>((resolve, reject) => {
      nginx!.once("error", reject);
      nginx!.once("exit", (code) => reject(new Error(`nginx exited before readiness: ${code}`)));
      nginx!.stderr!.on("data", (chunk: Buffer) => {
        if (chunk.toString().includes("start worker process")) resolve();
      });
    });
    return { close, fetch: async (request: Request) => {
      const url = new URL(request.url);
      return fetch(`http://127.0.0.1:${port}${url.pathname}${url.search}`, {
        method: request.method, headers: request.headers, redirect: "manual",
        ...(["GET", "HEAD"].includes(request.method) ? {} : { body: await request.arrayBuffer() }),
      });
    } };
  } catch (error) { await close(); throw error; }
}
