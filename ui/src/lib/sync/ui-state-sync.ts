import { writable } from "svelte/store";
import { createClientId } from "../sw/protocol.js";
import { contextStorage } from "./context-storage.js";
import { decodeContext, decodeSession } from "./ui-state-codecs.js";
import { accountPartition, contextKey, CONTEXT_DEBOUNCE, CONTEXT_SCHEMA,
  CONTEXT_TTL, MAX_CONTEXT_BYTES, MAX_CONTEXTS, SCHEMA_VERSION, SESSION_KEY, SESSION_SCHEMA,
  type SyncDependencies, type UiContext, type UiSession } from "./ui-state-contract.js";

export function createUiStateSync(d: SyncDependencies) {
  const now = d.now ?? Date.now;
  const uuid = d.uuid ?? createClientId;
  const tabId = uuid(); // A page instance, never a copied sessionStorage tab id.
  const peers = writable<UiContext[]>([]);
  let session: UiSession | null = null;
  let sub: string | null = null;
  let generation = 0;
  let revision = 0;
  const local = contextStorage(d.storage, d.notify);
  const { read, write, keys, purge } = local;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  function live() {
    if (!session || disposed) return false;
    // Memory-only operation stays usable when storage is blocked. It cannot
    // adopt or expose persisted peers without a matching canonical epoch.
    if (!local.available) return false;
    const canonical = decodeSession(read(SESSION_KEY) ?? "");
    return canonical !== null && !canonical.invalidated && canonical.partition === session.partition
      && canonical.sessionEpoch === session.sessionEpoch;
  }
  function suspend() {
    generation++; clearTimeout(timer); peers.set([]);
    session = null;
  }
  function receive(key: string | null) {
    if (disposed) return;
    if ((key === SESSION_KEY || key === null) && session && !live()) {
      purge(session.partition);
      suspend(); d.revalidate(true); return;
    }
    refresh();
  }
  function refresh() {
    if (!live()) { peers.set([]); return; }
    const seen = keys().flatMap((key) => {
      const c = decodeContext(read(key) ?? "", now());
      return c && contextKey(c) === key && c.partition === session!.partition
        && c.sessionEpoch === session!.sessionEpoch && c.tabId !== tabId ? [c] : [];
    });
    peers.set(seen.sort((a, b) => b.savedAt - a.savedAt).slice(0, MAX_CONTEXTS));
  }
  async function account(next: string | null) {
    if (disposed || (next === sub && session && live())) return;
    const previous = sub;
    if (next === null) {
      if (session) invalidate(); else suspend();
      sub = null; return;
    }
    if (session && previous !== next) invalidate();
    suspend(); sub = next;
    const operation = generation;
    const baseline = read(SESSION_KEY);
    let partition: string;
    try { partition = await (d.partition ?? accountPartition)(d.origin, next); }
    catch { return; }
    if (operation !== generation || disposed) return;
    const raw = read(SESSION_KEY);
    const current = raw === null ? null : decodeSession(raw);
    if (raw !== baseline && current?.partition !== partition) { suspend(); d.revalidate(true); return; }
    if (raw !== null && !current) return; // Unknown bytes are preserved.
    if (current?.partition === partition && current.invalidated) return;
    if (current && current.partition !== partition) {
      write(SESSION_KEY, JSON.stringify({ ...current, sessionEpoch: uuid(), invalidated: true }));
      purge(current.partition);
    }
    session = current?.partition === partition && !current.invalidated ? current
      : { schema: SESSION_SCHEMA, schemaVersion: SCHEMA_VERSION, partition,
        sessionEpoch: uuid(), invalidated: false };
    write(SESSION_KEY, JSON.stringify(session));
    refresh(); schedule();
  }
  function invalidate() {
    const old = session;
    suspend();
    if (!old) return;
    // Epoch first, then purge; no publication can race from this page.
    write(SESSION_KEY, JSON.stringify({ ...old, sessionEpoch: uuid(), invalidated: true }));
    purge(old.partition);
  }
  function flush() {
    clearTimeout(timer);
    if (!live()) return;
    const snapshot = d.snapshot();
    if (!snapshot) return;
    const savedAt = now();
    const value: UiContext = { schema: CONTEXT_SCHEMA, schemaVersion: SCHEMA_VERSION,
      partition: session!.partition, sessionEpoch: session!.sessionEpoch, workspaceId: snapshot.workspaceId,
      tabId, revision: ++revision, savedAt, expiresAt: savedAt + CONTEXT_TTL, payload: snapshot.payload };
    const raw = JSON.stringify(value);
    if (new TextEncoder().encode(raw).length > MAX_CONTEXT_BYTES || !decodeContext(raw, now())) return;
    const key = contextKey(value);
    const previous = read(key);
    if (previous !== null && !decodeContext(previous, now(), true)) return;
    // Preserve unknown versions. Evict only known, validated records.
    const entries = keys().map((key) => ({ key, c: decodeContext(read(key) ?? "", now(), true) }));
    const removable = entries.filter((e) => e.c && e.key !== key).sort((a, b) => a.c!.savedAt - b.c!.savedAt);
    let count = entries.length - (previous !== null ? 1 : 0);
    for (const entry of removable) {
      if (entry.c!.expiresAt > now() && count < MAX_CONTEXTS) continue;
      if (!local.remove(entry.key)) return;
      count--;
    }
    if (count >= MAX_CONTEXTS) return;
    write(key, raw);
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(flush, CONTEXT_DEBOUNCE); }
  async function adopt(candidate: UiContext) {
    const operation = generation;
    if (!live() || candidate.partition !== session!.partition || candidate.sessionEpoch !== session!.sessionEpoch || !sub) return false;
    // Re-read canonical bytes and permissions at the click, never trust the list.
    const raw = read(contextKey(candidate));
    const c = raw ? decodeContext(raw, now()) : null;
    if (!c || c.revision !== candidate.revision || c.tabId === tabId
      || c.partition !== session!.partition || c.sessionEpoch !== session!.sessionEpoch) return false;
    const allowed = await d.validateWorkspace(c.workspaceId, sub).catch(() => false);
    if (!allowed || operation !== generation || !live()) return false;
    d.apply(c.workspaceId, c.payload); schedule(); return true;
  }
  return { peers: { subscribe: peers.subscribe }, tabId, account, invalidate, receive, refresh, schedule, flush, adopt,
    prepareLogin() {
      const current = decodeSession(read(SESSION_KEY) ?? "");
      if (current?.invalidated) {
        if (local.remove(SESSION_KEY)) d.notify?.(SESSION_KEY);
      }
    },
    wake() { const changed = session !== null && !live(); suspend(); d.revalidate(changed); },
    dispose() { disposed = true; suspend(); } };
}
