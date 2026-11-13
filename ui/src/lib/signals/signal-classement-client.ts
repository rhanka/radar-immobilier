/**
 * Classement writes/reads through the EXISTING basket API only:
 * - GET  /api/v1/workspaces/:ws/signal-facets/reason-codes (facet_reason_codes, profile immo-steve-2026-09)
 * - POST /api/v1/workspaces/:ws/signal-facets/personal/{select,deselect,discard,restore}
 * - POST /api/v1/workspaces/:ws/signal-facets/workspace/{restore,discard} (moderators)
 * - POST personal/reclassify restores archives and applies selection atomically.
 */
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  fetchJsonWithTimeout,
  readJsonErrorCode,
} from "$lib/net/fetch-with-timeout.js";
import {
  GraphSignalsHttpError,
  fetchGraphSignalDetail,
  scopedSignalFacetsPath,
  type SignalScope,
} from "./graph-signal-detail-client.js";
import {
  validateClassementChoice,
  buildClassementMap,
  classementKey,
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
  // Fail closed: a constant key would collide across distinct commands.
  throw new Error("random_uuid_unavailable");
}

/** Returns the new head event id (`event.id`), or null for a no-op. */
async function postCommand(
  scope: SignalScope,
  action: "select" | "deselect" | "discard",
  body: Record<string, unknown>,
): Promise<string | null> {
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
  const event = (res.json as { event?: { id?: unknown } | null } | null)?.event;
  return typeof event?.id === "string" ? event.id : null;
}

/** Visible (French) message for a failed classement write. */
export function classementWriteErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message === "classement_result_uncertain") {
    return "Résultat du classement à vérifier. Rechargez les données pour connaître son état.";
  }
  if (error instanceof GraphSignalsHttpError) {
    if (error.code === "target_version_conflict") return "Classement non enregistré : le signal a changé depuis l'affichage (conflit d'empreinte). Données rechargées.";
    if (error.status === 409) return "Classement non enregistré : conflit avec un classement plus récent (409). Données rechargées.";
    if (error.status === 422) return `Classement non enregistré : motif invalide (422${error.code ? ` — ${error.code}` : ""}).`;
    return `Classement non enregistré (${error.status}${error.code ? ` — ${error.code}` : ""}). Données rechargées.`;
  }
  if (error instanceof Error && error.message.startsWith("classement_rollback_failed")) {
    return "Classement non enregistré et retour à l'état précédent incomplet — données rechargées.";
  }
  if (error instanceof Error && error.message === "reason_code_required") return "Classement non enregistré : un motif N-* est requis pour Écarté.";
  return "Classement non enregistré. Données rechargées.";
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

async function restoreAtomically(scope: SignalScope, args: ApplyClassementArgs): Promise<void> {
  const key = newCommandKey();
  const body = JSON.stringify({
    target: args.target, displayedFingerprint: args.displayedFingerprint,
    archives: Object.fromEntries(args.current.archiveRestores.map((head) => [head.scope, head.id])),
    selectionHeads: {
      pertinent: args.current.pertinentExpectedHeadId ?? args.current.pertinentHeadId,
      a_surveiller: args.current.aSurveillerExpectedHeadId ?? args.current.aSurveillerHeadId,
    },
    nextClass: args.nextClass, ...(args.reasonCode ? { reasonCode: args.reasonCode } : {}),
  });
  let uncertain = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchJsonWithTimeout<unknown>(scopedSignalFacetsPath(scope, "personal/reclassify"), {
        timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
        init: { method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": key }, body },
      });
      if (res.ok) return;
      throw new GraphSignalsHttpError(`classement reclassify: ${res.status}`, res.status, readJsonErrorCode(res.json));
    } catch (error) {
      const definitive = error instanceof GraphSignalsHttpError && error.status < 500;
      if (definitive && !uncertain) throw error;
      uncertain = true;
      if (definitive) break;
    }
  }
  // A proxy can lose every reply after commit. Read real state before reporting uncertainty.
  try {
    const state = await fetchGraphSignalDetail(scope, args.target.citySlug, { showDiscarded: true });
    const actual = buildClassementMap(state.selection ?? [], state.heads)
      .get(classementKey(args.target.type, args.target.id, args.target.citySlug));
    if (actual && !actual.discarded && actual.classe === args.nextClass
      && actual.reasonCode === (args.reasonCode ?? null)) return;
  } catch { /* Leave the result uncertain when reconciliation is unavailable. */ }
  throw new Error("classement_result_uncertain");
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
  if (nextClass !== "ecarte" && current.restoreBlockedReason) {
    throw new Error("workspace_capability_required");
  }

  const activeBaskets: ("pertinent" | "a_surveiller")[] = [];
  if (current.pertinentHeadId) activeBaskets.push("pertinent");
  if (current.aSurveillerHeadId) activeBaskets.push("a_surveiller");
  const headFor = (basket: "pertinent" | "a_surveiller"): string | null =>
    basket === "pertinent" ? current.pertinentHeadId : current.aSurveillerHeadId;
  // Writes compare against the stream head in ANY state: a basket that
  // was deselected keeps an inactive head, and null would 409.
  const expectedHeadFor = (basket: "pertinent" | "a_surveiller"): string | null =>
    basket === "pertinent"
      ? current.pertinentExpectedHeadId ?? current.pertinentHeadId
      : current.aSurveillerExpectedHeadId ?? current.aSurveillerHeadId;

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

  if (current.archiveRestores.length > 0) {
    await restoreAtomically(scope, args);
    return;
  }

  // F4: multi-POST sequences are not atomic server-side. Track each
  // completed step's compensating command; on a mid-sequence failure, run
  // them in reverse (with the head ids the completed steps produced) so
  // the previous classement is restored, then rethrow the original error.
  const undo: (() => Promise<void>)[] = [];
  const reasonFor = (basket: "pertinent" | "a_surveiller"): string | null =>
    current.classe === basket ? current.reasonCode : null;
  try {
    if (nextClass === "non_classe") {
      for (const basket of activeBaskets) {
        const newHead = await postCommand(scope, "deselect", {
          target, basket, expectedHeadId: headFor(basket), displayedFingerprint,
        });
        undo.push(async () => {
          const code = reasonFor(basket);
          await postCommand(scope, "select", {
            target, basket, ...(code ? { reasonCode: code } : {}),
            expectedHeadId: newHead ?? headFor(basket), displayedFingerprint,
          });
        });
      }
      return;
    }

    const basket = nextClass;
    const other = basket === "pertinent" ? "a_surveiller" : "pertinent";
    if (headFor(other)) {
      const newHead = await postCommand(scope, "deselect", {
        target, basket: other, expectedHeadId: headFor(other), displayedFingerprint,
      });
      undo.push(async () => {
        const code = reasonFor(other);
        await postCommand(scope, "select", {
          target, basket: other, ...(code ? { reasonCode: code } : {}),
          expectedHeadId: newHead ?? headFor(other), displayedFingerprint,
        });
      });
    }
    await postCommand(scope, "select", {
      target,
      basket,
      ...(reasonCode ? { reasonCode } : {}),
      expectedHeadId: expectedHeadFor(basket),
      displayedFingerprint,
    });
  } catch (error) {
    let rollbackFailed = false;
    for (const step of [...undo].reverse()) {
      try {
        await step();
      } catch {
        rollbackFailed = true;
      }
    }
    if (rollbackFailed) {
      throw new Error(`classement_rollback_failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    throw error;
  }
}
