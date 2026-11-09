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
  // Fail closed: a constant key would collide across distinct commands.
  throw new Error("random_uuid_unavailable");
}

/** Returns the new head event id (`event.id`), or null for a no-op. */
async function postCommand(
  scope: SignalScope,
  action: "select" | "deselect" | "discard" | "restore",
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

  // F4: multi-POST sequences are not atomic server-side. Track each
  // completed step's compensating command; on a mid-sequence failure, run
  // them in reverse (with the head ids the completed steps produced) so
  // the previous classement is restored, then rethrow the original error.
  const undo: (() => Promise<void>)[] = [];
  const reasonFor = (basket: "pertinent" | "a_surveiller"): string | null =>
    current.classe === basket ? current.reasonCode : null;
  try {
    if (current.discarded) {
      const restoredHead = await postCommand(scope, "restore", {
        target, expectedHeadId: current.archiveHeadId, displayedFingerprint,
      });
      undo.push(async () => {
        if (!current.reasonCode) throw new Error("rollback_reason_missing");
        await postCommand(scope, "discard", {
          target, reasonCode: current.reasonCode,
          expectedHeadId: restoredHead ?? current.archiveHeadId, displayedFingerprint,
        });
      });
    }

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
      expectedHeadId: headFor(basket),
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
