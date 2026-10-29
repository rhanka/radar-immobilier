/**
 * PW-C page gestures: strict client-side shape for the six write operations.
 *
 * The page can only prepare an intent and poll its public status; it can
 * never confirm. The server revalidates everything strictly. Inputs
 * (workspace, target, heads, fingerprint, projection token) are read from
 * the host page state.
 */

export const PW_PAGE_PREPARE_PATH = "/__reader/api/facets.write-intents.prepare.v1";
export const PW_PAGE_STATUS_PATH = "/__reader/api/facets.write-intents.status.v1";

export const PW_PAGE_OPERATIONS = [
  "facets.signals.personal.select.v1",
  "facets.signals.personal.deselect.v1",
  "facets.signals.personal.discard.v1",
  "facets.signals.personal.restore.v1",
  "facets.signals.workspace.discard.v1",
  "facets.signals.workspace.restore.v1",
] as const;

export type PwPageOperation = (typeof PW_PAGE_OPERATIONS)[number];

/** Follow-up budget: interval, fixed window, poll cap, manual spacing. */
export const PW_PAGE_POLL_BOUNDS = {
  intervalMs: 2000,
  windowMs: 120000,
  maxPolls: 60,
  manualSpacingMs: 30000,
  requestTimeoutMs: 15000,
} as const;

export interface PwPageGesture {
  readonly operation: string;
  readonly workspaceId: string;
  readonly target: { readonly citySlug: string; readonly type: string; readonly id: string };
  readonly basket?: string | undefined;
  readonly reasonCode?: string | undefined;
  readonly deselect?: readonly string[] | undefined;
  readonly expectedHeadId?: string | null | undefined;
  readonly expectedSelectionHeads?: Readonly<Record<string, string | null>> | undefined;
  readonly displayedFingerprint: string;
  readonly expectedProjectionToken: string;
}

/** Client-side shape check; the server revalidates everything strictly. */
function pagePrepareBody(gesture: PwPageGesture, operations: readonly string[]): Record<string, unknown> {
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const HEX64_PATTERN = /^[a-f0-9]{64}$/;
  const CITY_PATTERN = /^[a-z0-9-]{1,128}$/;
  const BASKETS = ["pertinent", "a_surveiller"];
  function fail(message: string): never { throw new Error(`invalid gesture: ${message}`); }
  if (gesture === null || typeof gesture !== "object" || Array.isArray(gesture)) fail("gesture");
  if (!operations.includes(gesture.operation)) fail("operation");
  if (typeof gesture.workspaceId !== "string" || !UUID_PATTERN.test(gesture.workspaceId)) fail("workspaceId");
  const target = gesture.target;
  if (target === null || typeof target !== "object" || Array.isArray(target)) fail("target");
  if (typeof target.citySlug !== "string" || !CITY_PATTERN.test(target.citySlug)) fail("citySlug");
  if (target.type !== "Signal" && target.type !== "DesignationEvent") fail("type");
  if (typeof target.id !== "string" || target.id.length < 1 || target.id.length > 512) fail("id");
  if (gesture.basket !== undefined && !BASKETS.includes(gesture.basket)) fail("basket");
  if (gesture.reasonCode !== undefined
    && (typeof gesture.reasonCode !== "string" || gesture.reasonCode.length < 1
      || gesture.reasonCode.length > 128)) fail("reasonCode");
  let deselect: string[] | undefined;
  if (gesture.deselect !== undefined) {
    if (!Array.isArray(gesture.deselect) || gesture.deselect.length > 2) fail("deselect");
    deselect = [...gesture.deselect].sort();
    if (new Set(deselect).size !== deselect.length) fail("deselect");
    for (const entry of deselect) if (!BASKETS.includes(entry)) fail("deselect");
  }
  if (gesture.expectedHeadId !== undefined && gesture.expectedHeadId !== null
    && !UUID_PATTERN.test(gesture.expectedHeadId)) fail("expectedHeadId");
  if (gesture.expectedSelectionHeads !== undefined) {
    const heads = gesture.expectedSelectionHeads;
    if (heads === null || typeof heads !== "object" || Array.isArray(heads)) fail("expectedSelectionHeads");
    for (const [basket, head] of Object.entries(heads)) {
      if (!BASKETS.includes(basket)) fail("expectedSelectionHeads");
      if (head !== null && !UUID_PATTERN.test(head)) fail("expectedSelectionHeads");
    }
  }
  if (!HEX64_PATTERN.test(gesture.displayedFingerprint)) fail("displayedFingerprint");
  if (!HEX64_PATTERN.test(gesture.expectedProjectionToken)) fail("expectedProjectionToken");
  const body: Record<string, unknown> = { operation: gesture.operation,
    workspaceId: gesture.workspaceId,
    target: { citySlug: target.citySlug, type: target.type, id: target.id },
    expectedHeadId: gesture.expectedHeadId ?? null,
    displayedFingerprint: gesture.displayedFingerprint,
    expectedProjectionToken: gesture.expectedProjectionToken };
  if (gesture.basket !== undefined) body.basket = gesture.basket;
  if (gesture.reasonCode !== undefined) body.reasonCode = gesture.reasonCode;
  if (deselect !== undefined) body.deselect = deselect;
  if (gesture.expectedSelectionHeads !== undefined) body.expectedSelectionHeads = gesture.expectedSelectionHeads;
  return body;
}

/** The browser and exported helper share one self-contained implementation. */
export const PW_PAGE_BUILD_BODY_SOURCE = pagePrepareBody.toString();
export function buildPagePrepareBody(gesture: PwPageGesture): Record<string, unknown> {
  return pagePrepareBody(gesture, PW_PAGE_OPERATIONS);
}
