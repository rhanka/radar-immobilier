// Loopback TCP relay for the real-stack suite: serves the UI container on
// http://localhost:<port> inside the runner so the browser runs in a secure
// context (crypto.randomUUID), as production does over HTTPS.
//   node ui/e2e-real/local-proxy.mjs <listenPort> <upstreamHost:port>
import net from "node:net";

const [listenPort, upstream] = process.argv.slice(2);
const [host, port] = String(upstream).split(":");
net.createServer((client) => {
  const server = net.connect(Number(port), host);
  client.pipe(server).pipe(client);
  const close = () => { client.destroy(); server.destroy(); };
  client.on("error", close);
  server.on("error", close);
}).listen(Number(listenPort), "127.0.0.1", () => {
  console.log(`[e2e] relay 127.0.0.1:${listenPort} -> ${upstream}`);
});
