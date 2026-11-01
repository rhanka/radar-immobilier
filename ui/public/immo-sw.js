/* IMMO coordination v1. No fetch interception or durable worker state. */
/* global self, URL, MessageChannel, TextEncoder, setTimeout, clearTimeout */
const WORKER_BUILD_ID = "__IMMO_WORKER_BUILD_ID__";
const known = new Set();
const uuid = (v) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const text = (v) => typeof v === "string" && v.length > 0 && v.length <= 128;
const record = (v) => v && typeof v === "object" && !Array.isArray(v);
const keys = (v, allowed) => Object.keys(v).every((key) => allowed.includes(key));
function valid(m) {
  if (!record(m) || !keys(m, ["protocol", "type", "id", "correlationId", "payload"])
    || m.protocol !== 1 || !text(m.id) || (m.correlationId !== undefined && !text(m.correlationId))) return false;
  try { if (new TextEncoder().encode(JSON.stringify(m)).length > 8192) return false; }
  catch { return false; }
  const p = m.payload;
  if (m.type === "PING" || m.type === "ACTIVATE_COMPATIBLE") return p === undefined;
  if (!record(p)) return false;
  if (m.type === "HELLO") return keys(p, ["clientBuildId", "tabId", "protocolVersion"])
    && text(p.clientBuildId) && uuid(p.tabId) && Number.isInteger(p.protocolVersion);
  if (m.type === "INVALIDATE") return keys(p, ["scope", "workspaceId", "citySlug"])
    && ["signals", "workspace", "context"].includes(p.scope)
    && (p.workspaceId === undefined || uuid(p.workspaceId)) && (p.citySlug === undefined || text(p.citySlug));
  return m.type === "SESSION_INVALIDATED" && keys(p, ["partition", "epoch"])
    && text(p.partition) && uuid(p.epoch);
}
const info = { workerBuildId: WORKER_BUILD_ID, protocolVersion: 1 };
const message = (type, correlationId, payload) => ({ protocol: 1, type,
  id: self.crypto.randomUUID(), ...(correlationId ? { correlationId } : {}), payload });
function uiClient(client) {
  if (!client || client.type !== "window") return false;
  const url = new URL(client.url);
  return url.origin === self.location.origin && !url.pathname.startsWith("/__reader/");
}
async function windows() {
  return (await self.clients.matchAll({ type: "window", includeUncontrolled: true })).filter(uiClient);
}
// Probe browser clients, including uncontrolled/unknown tabs; memory is disposable.
async function compatible(client) {
  const challenge = message("HELLO", undefined, info);
  const channel = new MessageChannel();
  return new Promise((resolve) => {
    const finish = (ok) => { clearTimeout(timer); channel.port1.close(); resolve(ok); };
    const timer = setTimeout(() => finish(false), 700);
    channel.port1.onmessage = ({ data }) => finish(valid(data) && data.type === "HELLO"
      && data.correlationId === challenge.id && data.payload.protocolVersion === 1);
    try { client.postMessage(challenge, [channel.port2]); }
    catch { finish(false); }
  });
}
async function handle(event) {
  const port = event.ports[0];
  const source = event.source?.id ? await self.clients.get(event.source.id) : null;
  if (!port || !uiClient(source)) return;
  const m = event.data;
  const reply = (type, payload) => port.postMessage(message(type, m?.id, payload));
  if (!valid(m)) { reply("ERROR", { reason: "invalid-message" }); return; }
  if (m.type === "HELLO") {
    if (m.payload.protocolVersion === 1) { known.add(source.id); reply("HELLO_ACK", info); }
    else reply("ERROR", { reason: "incompatible-client" });
    return;
  }
  if (!known.has(source.id)) { reply("ERROR", { reason: "handshake-required" }); return; }
  if (m.type === "PING") { reply("PONG", info); return; }
  if (m.type === "ACTIVATE_COMPATIBLE") {
    const present = await windows();
    const checks = await Promise.all(present.map(compatible));
    const after = await windows();
    const ok = checks.every(Boolean) && after.every((c) => present.some((p) => p.id === c.id));
    reply("ACTIVATE_RESULT", { ok, ...(!ok ? { reason: "unknown-or-incompatible-client" } : {}) });
    if (ok) await self.skipWaiting();
    return;
  }
  let relayedTo = 0;
  const present = await windows();
  for (const id of known) if (!present.some((c) => c.id === id)) known.delete(id);
  for (const client of present) {
    if (client.id === source.id || !known.has(client.id)) continue;
    client.postMessage(message(m.type, undefined, m.payload)); relayedTo++;
  }
  reply(`${m.type}_RELAYED`, { relayedTo });
}
// Natural first activation; no automatic skipWaiting and no clients.claim.
self.addEventListener("message", (event) => event.waitUntil(handle(event)));
