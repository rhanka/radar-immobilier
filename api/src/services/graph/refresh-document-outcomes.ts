import type { Database } from "../../db/client.js";
import { refreshDocumentOutcomes } from "../../db/schema.js";
import type { RefreshCorpusDocument } from "./refresh-corpus.js";
import { refreshFallbackReason, type RefreshModelReceipt } from "./refresh-model-policy.js";

/** Explicit metadata allowlist: never persist prompts, excerpts, URLs, or error messages. */
export async function appendRefreshDocumentOutcome(db: Database, input: {
  cycleId: string; document: RefreshCorpusDocument; createdAt: Date; latencyMs: number;
  receipts: readonly RefreshModelReceipt[]; attempts: number; accepted: boolean; error: unknown;
}) {
  const extraction = input.receipts.filter(({ transition }) => transition !== "verification").at(-1);
  const failure = input.receipts.filter(({ status }) => status !== "completed").at(-1);
  const verifications = input.receipts.flatMap(({ verification }) => verification ? [verification] : []);
  await db.insert(refreshDocumentOutcomes).values({
    cycleId: input.cycleId, documentSha: input.document.sha256, citySlug: input.document.citySlug,
    createdAt: input.createdAt, pageCount: input.document.pages.length,
    provider: extraction?.modelUsed?.provider ?? null, model: extraction?.modelUsed?.model ?? null,
    effort: extraction?.modelUsed?.effort ?? null, transition: extraction?.transition ?? null,
    status: input.accepted ? "accepted" : "refused",
    failureReason: failure?.status === "quality-refused" ? "quality"
      : failure?.failureReason ?? (input.accepted ? null : refreshFallbackReason(input.error)),
    fallbackReason: extraction?.fallbackReason ?? null,
    attempts: input.receipts.length || input.attempts, latencyMs: input.latencyMs,
    unknownIds: verifications.reduce((sum, item) => sum + (item.unknown_ids ?? 0), 0),
    keptNoValidDecision: verifications.reduce((sum, item) => sum + (item.kept_no_valid_decision ?? 0), 0),
    supportedUngrounded: verifications.reduce((sum, item) => sum + (item.supported_ungrounded ?? 0), 0),
    actsJudged: verifications.reduce((sum, item) => sum + (item.acts ?? 0), 0),
    actsRemoved: verifications.reduce((sum, item) => sum + (item.removed ?? 0), 0),
    skippedFallback: verifications.filter(({ status }) => status === "skipped-fallback").length,
  });
}
