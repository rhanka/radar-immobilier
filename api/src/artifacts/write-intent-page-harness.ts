// Shared vm harness for the PW-C page script tests: executes the exact
// served bytes with stub browser globals and drives clicks and timers.
import { runInNewContext } from "node:vm";
import { PW_PAGE_SCRIPT } from "./write-intent-page.js";

export const HEX64 = "a".repeat(64);
export const UUID = "11111111-1111-4111-8111-111111111111";

export interface GestureDataset {
  pwOperation: string;
  pwWorkspace: string;
  pwCity: string;
  pwType: string;
  pwId: string;
  pwBasket?: string;
  pwReason?: string;
  pwDeselect?: string;
  pwExpectedHead?: string;
  pwExpectedHeads?: string;
  pwFingerprint: string;
  pwToken: string;
}

const SELECT = { pwWorkspace: UUID, pwCity: "demo-town", pwType: "Signal",
  pwFingerprint: HEX64, pwToken: HEX64 };
export const GESTURES: GestureDataset[] = [
  { ...SELECT, pwOperation: "facets.signals.personal.select.v1", pwId: "sig-1", pwBasket: "pertinent" },
  { ...SELECT, pwOperation: "facets.signals.personal.deselect.v1", pwId: "sig-1", pwBasket: "a_surveiller" },
  { ...SELECT, pwOperation: "facets.signals.personal.discard.v1", pwId: "sig-1",
    pwReason: "NON-PERTINENT", pwDeselect: "pertinent",
    pwExpectedHeads: JSON.stringify({ pertinent: null }) },
  { ...SELECT, pwOperation: "facets.signals.personal.restore.v1", pwId: "sig-1" },
  { ...SELECT, pwOperation: "facets.signals.workspace.discard.v1", pwId: "sig-2",
    pwType: "DesignationEvent", pwReason: "NON-PERTINENT" },
  { ...SELECT, pwOperation: "facets.signals.workspace.restore.v1", pwId: "sig-3" },
];

export class FakeElement {
  dataset: Record<string, unknown> = {};
  disabled = false;
  hidden = true;
  textContent = "";
  children: unknown[] = [];
  listeners: Record<string, Array<(event: unknown) => void>> = {};
  selector: string | null = null;
  href = "";
  target = "";
  rel = "";
  constructor(public id: string | null = null) {}
  closest(sel: string): FakeElement | null {
    return sel === this.selector ? this : null;
  }
  addEventListener(type: string, fn: (event: unknown) => void): void {
    (this.listeners[type] ??= []).push(fn);
  }
  appendChild(child: unknown): void {
    this.children.push(child);
  }
  removeChild(child: unknown): void {
    this.children = this.children.filter((entry) => entry !== child);
  }
  get firstChild(): unknown {
    return this.children[0] ?? null;
  }
}

export interface FetchCall {
  url: string;
  options: { method?: string; headers?: Record<string, string>; body?: string };
}

export function pageHarness(options: { storage?: Map<string, string>; initialNow?: number; storageUnavailable?: boolean } = {}) {
  const storage = options.storage ?? new Map<string, string>();
  const elements: Record<string, FakeElement> = {};
  for (const id of ["pw-write-note", "pw-write-open", "pw-write-retry",
    "pw-write-manual", "pw-bootstrap", "pw-receipt", "pw-page-bootstrap", "pw-page-receipt",
    "pw-live-state", "pw-live-cards", "pw-live-counts"]) {
    elements[id] = new FakeElement(id);
  }
  elements["pw-write-manual"]!.dataset = {};
  elements["pw-page-bootstrap"]!.textContent = JSON.stringify({ pageInstanceId: "instance-1", csrf: "c".repeat(40),
    readerSub: "reader", appOrigin: "https://app.example.test", workspaceId: UUID, readGrant: "synthetic-read" });
  const docListeners: Record<string, Array<(event: unknown) => void>> = {};
  const fetchCalls: FetchCall[] = [];
  const responders: Array<(call: FetchCall) => unknown> = [];
  const readCalls: FetchCall[] = [];
  const readResponders: Array<(call: FetchCall) => unknown> = [];
  const renewCalls: FetchCall[] = [];
  const renewResponders: Array<(call: FetchCall) => unknown> = [];
  let currentGesture = GESTURES[0]!;
  const readFixture = (url: string) => {
    const g = currentGesture;
    const selections = g.pwExpectedHeads ? JSON.parse(g.pwExpectedHeads) : {};
    const head = (id?: string | null) => id ? { id, state: "active" } : null;
    return { status: 200, body: { ok: true, workspaceId: g.pwWorkspace, snapshot: { baseToken: g.pwToken },
      ...(url.includes("baskets.search") ? { items: [], counts: { matched: 0 } } : {
        item: { target: { citySlug: g.pwCity, type: g.pwType, id: g.pwId }, displayedFingerprint: g.pwFingerprint,
          facets: { selection: { pertinent: head(selections.pertinent ?? (g.pwBasket === "pertinent" ? g.pwExpectedHead : null)),
            a_surveiller: head(selections.a_surveiller ?? (g.pwBasket === "a_surveiller" ? g.pwExpectedHead : null)) },
          archive: { personal: g.pwOperation.includes(".personal.") ? head(g.pwExpectedHead) : null,
            workspace: g.pwOperation.includes(".workspace.") ? head(g.pwExpectedHead) : null } } },
      }) } };
  };
  const opened: Array<{ url: string; target: string; features: string }> = [];
  const committed: unknown[] = [];
  const timers: Array<{ delay: number; fn: () => void; cleared: boolean }> = [];
  let now = options.initialNow ?? 1_000_000;
  let keys = 0;
  const documentStub = {
    hidden: false,
    querySelector: (sel: string): FakeElement | null => {
      if (sel.startsWith("#")) return elements[sel.slice(1)] ?? null;
      return null;
    },
    createElement: () => new FakeElement(),
    createTextNode: (text: string) => ({ text }),
    addEventListener: (type: string, fn: (event: unknown) => void): void => {
      (docListeners[type] ??= []).push(fn);
    },
  };
  const sandbox: Record<string, unknown> = {
    document: documentStub,
    window: {
      sessionStorage: {
        getItem: (key: string) => {
          if (options.storageUnavailable) throw new Error("Synthetic storage unavailable");
          return storage.get(key) ?? null;
        },
        setItem: (key: string, value: string) => {
          if (options.storageUnavailable) throw new Error("Synthetic storage unavailable");
          storage.set(key, value);
        },
      },
      open: (url: string, target: string, features: string) => {
        opened.push({ url, target, features });
        return null;
      },
      __pwWriteOnCommitted: (data: unknown) => {
        committed.push(data);
      },
    },
    crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(keys += 1).padStart(12, "0")}` },
    fetch: async (url: string, options: FetchCall["options"]) => {
      const isRead = url.startsWith("/__reader/api/baskets.");
      const isRenew = url === "/__reader/renew";
      (isRead ? readCalls : isRenew ? renewCalls : fetchCalls).push({ url, options });
      const responder = (isRead ? readResponders : isRenew ? renewResponders : responders).shift() ??
        (isRead ? () => readFixture(url) : isRenew ? () => ({ status: 200, body: { grant: "fresh-read" } })
          : () => ({ status: 500, body: null }));
      const out = await responder({ url, options }) as { status: number; body: unknown; retryAfter?: string };
      return {
        status: out.status,
        ok: out.status >= 200 && out.status < 300,
        headers: { get: (name: string) => (name === "retry-after" ? out.retryAfter ?? null : null) },
        json: async () => out.body,
      };
    },
    setTimeout: (fn: () => void, delay: number): number => {
      timers.push({ delay, fn, cleared: false });
      return timers.length - 1;
    },
    clearTimeout: (id: number): void => {
      if (timers[id]) timers[id]!.cleared = true;
    },
    Date: { now: () => now, parse: Date.parse },
    URLSearchParams,
  };
  runInNewContext(PW_PAGE_SCRIPT, sandbox);
  const window = sandbox.window as { __pwWriteOnCommitted: (data: unknown, current?: () => boolean) => Promise<void> };
  const onCommitted = window.__pwWriteOnCommitted;
  window.__pwWriteOnCommitted = async (data, current) => { committed.push(data); return onCommitted(data, current); };
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 40; i += 1) await Promise.resolve();
  };
  const clickGesture = async (dataset: GestureDataset): Promise<void> => {
    currentGesture = dataset;
    const button = new FakeElement();
    button.selector = "[data-pw-gesture]";
    button.dataset = { ...dataset };
    for (const fn of docListeners.click ?? []) fn({ target: button });
    await flush();
  };
  const runTimer = async (delay?: number): Promise<void> => {
    const next = timers.find((timer) => !timer.cleared && (delay === undefined || timer.delay === delay));
    if (next) {
      next.cleared = true;
      next.fn();
      await flush();
    }
  };
  const pendingDelays = (): number[] => timers.filter((timer) => !timer.cleared)
    .map((timer) => timer.delay);
  const seenFollowUp: string[] = [];
  return { elements, fetchCalls, responders, readCalls, readResponders, renewCalls, renewResponders, opened, committed, seenFollowUp,
    pendingDelays, clickGesture, runTimer, flush,
    hookFollowUp: (): void => {
      (sandbox.window as { __pwWriteFollowUp?: unknown }).__pwWriteFollowUp =
        (intentId: string) => {
          seenFollowUp.push(intentId);
        };
    },
    followUp: (intentId: string): void => {
      (sandbox.window as { __pwWritePrepared: (id: string, gesture: unknown) => void }).__pwWritePrepared(intentId,
        { workspaceId: UUID, target: { citySlug: "demo-town", type: "Signal", id: "sig-1" } });
      (sandbox.window as { __pwWriteFollowUp: (id: string) => void }).__pwWriteFollowUp(intentId);
    },
    setNow: (value: number): void => {
      now = value;
    },
    setHidden: (value: boolean): void => {
      documentStub.hidden = value;
    },
    dispatchVisibility: (): void => {
      for (const fn of docListeners.visibilitychange ?? []) fn({});
    } };
}

export function prepared(intentId: string, state = "pending") {
  return { status: 201, body: { operation: "facets.write-intents.prepare.v1",
    reader: { sub: "reader" },
    data: { intentId, invocationId: UUID, state,
      expiresAt: new Date(1_000_000 + 120_000).toISOString(),
      confirmationUrl: `https://app.example.test/artifact-write/intents/${intentId}`,
      managementUrl: `https://app.example.test/artifact-write/intents/${intentId}`,
      statusUrl: `https://app.example.test/api/v1/artifacts/reader/facets/write-intents/${intentId}` } } };
}

export function statusOf(intentId: string, state: string, extra: Record<string, unknown> = {}) {
  const terminal = state === "committed" ? { commandId: UUID, nextAction: "refresh_state", receipt: { event: null } } : {};
  return { status: 200, body: { operation: "facets.write-intents.status.v1",
    reader: { sub: "reader" }, data: { intentId, state, ...(state === "pending" ? { expiresAt: new Date(1_120_000).toISOString() } : {}),
      ...terminal, ...extra } } };
}
