/**
 * Classement writes/reads through the EXISTING basket API only:
 * - GET  /api/v1/workspaces/:ws/signal-facets/reason-codes (facet_reason_codes, profile immo-steve-2026-09)
 * - POST /api/v1/workspaces/:ws/signal-facets/personal/{select,deselect,discard,restore}
 * Same services as the artifact basket bridge (reader-baskets.ts). No new endpoint.
 */
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  fetchJsonWithTimeout,
  readJsonErrorCode,
} from "$lib/net/fetch-with-timeout.js";
import {
  GraphSignalsHttpError,
  scopedSignalFacetsPath,
  type SignalScope,
} from "./graph-signal-detail-client.js";
import {
  validateClassementChoice,
  type ClassementEntry,
  type ReasonCodeEntry,
  type SignalClass,
} from "./signal-classement.js";

export interface ClassementTarget {
  citySlug: string;
  type: "Signal" | "DesignationEvent";
  id: string;
}

function newCommandKey(): string {
  const cryptoRef = globalThis.crypto as Crypto | undefined;
  if (cryptoRef && typeof cryptoRef.randomUUID === "function") return cryptoRef.randomUUID();
  return "00000000-0000-4000-8000-000000000000";
}

async function postCommand(
  scope: SignalScope,
  action: "select" | "deselect" | "discard" | "restore",
  body: Record<string, unknown>,
): Promise<void> {
  const res = await fetchJsonWithTimeout<unknown>(
    scopedSignalFacetsPath(scope, `personal/${action}`),
    {
      timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
      init: {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": newCommandKey() },
        body: JSON.stringify(body),
      },
    },
  );
  if (!res.ok) {
    throw new GraphSignalsHttpError(`classement ${action}: ${res.status}`, res.status, readJsonErrorCode(res.json));
  }
}

export async function fetchReasonCodes(scope: SignalScope): Promise<ReasonCodeEntry[]> {
  const res = await fetchJsonWithTimeout<unknown>(
    scopedSignalFacetsPath(scope, "reason-codes"),
    { timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS, init: { cache: "no-store" } },
  );
  if (!res.ok) {
    throw new GraphSignalsHttpError(`reason-codes: ${res.status}`, res.status, readJsonErrorCode(res.json));
  }
  const body = res.json as { codes?: unknown } | null;
  if (!body || !Array.isArray(body.codes)) throw new Error("reason-codes: invalid response");
  return body.codes as ReasonCodeEntry[];
}

export interface ApplyClassementArgs {
  target: ClassementTarget;
  displayedFingerprint: string;
  current: ClassementEntry;
  nextClass: SignalClass;
  reasonCode?: string | null;
  catalog?: readonly ReasonCodeEntry[];
}

export async function applyClassement(scope: SignalScope, args: ApplyClassementArgs): Promise<void> {
  const { target, displayedFingerprint, current, nextClass } = args;
  const reasonCode = args.reasonCode ?? null;
  if (args.catalog) {
    const check = validateClassementChoice(nextClass, reasonCode, args.catalog);
    if (!check.ok) throw new Error(check.error);
  }
  if (nextClass === "ecarte" && !reasonCode) throw new Error("reason_code_required");
  if (nextClass === current.classe && reasonCode === current.reasonCode) return;

  const activeBaskets: ("pertinent" | "a_surveiller")[] = [];
  if (current.pertinentHeadId) activeBaskets.push("pertinent");
  if (current.aSurveillerHeadId) activeBaskets.push("a_surveiller");
  const headFor = (basket: "pertinent" | "a_surveiller"): string | null =>
    basket === "pertinent" ? current.pertinentHeadId : current.aSurveillerHeadId;

  if (nextClass === "ecarte") {
    const deselect = activeBaskets;
    await postCommand(scope, "discard", {
      target,
      reasonCode,
      ...(deselect.length > 0
        ? {
            deselect,
            expectedSelectionHeads: Object.fromEntries(deselect.map((b) => [b, headFor(b)])),
          }
        : {}),
      expectedHeadId: current.archiveHeadId,
      displayedFingerprint,
    });
    return;
  }

  if (current.discarded) {
    await postCommand(scope, "restore", {
      target, expectedHeadId: current.archiveHeadId, displayedFingerprint,
    });
  }

  if (nextClass === "non_classe") {
    for (const basket of activeBaskets) {
      await postCommand(scope, "deselect", {
        target, basket, expectedHeadId: headFor(basket), displayedFingerprint,
      });
    }
    return;
  }

  const basket = nextClass;
  const other = basket === "pertinent" ? "a_surveiller" : "pertinent";
  if (headFor(other)) {
    await postCommand(scope, "deselect", {
      target, basket: other, expectedHeadId: headFor(other), displayedFingerprint,
    });
  }
  await postCommand(scope, "select", {
    target,
    basket,
    ...(reasonCode ? { reasonCode } : {}),
    expectedHeadId: headFor(basket),
    displayedFingerprint,
  });
}
