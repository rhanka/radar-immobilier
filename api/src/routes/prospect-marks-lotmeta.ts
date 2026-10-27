import { z } from "zod";
import type { ContractDetail } from "@radar/domain";
import { contractSafeParse } from "@radar/domain";

const MAX_BAD_ENTRIES = 32;
const MAX_ISSUES = 128;

const lotMetaKey = z.string().guid();
const lotMetaValue = z.object({ noLot: z.string().min(1), citySlug: z.string().min(1) });

export interface LotMetaCheck {
  ok: boolean;
  data?: Record<string, { noLot: string; citySlug: string }>;
  details?: ContractDetail[];
}

/**
 * Project-owned lotMeta validator (conception 4.1.1).
 * Validates every own key and value independently on the raw JSON value,
 * before any record native parsing. A bad key never hides a bad value.
 * Reconstruction is bounded: 32 bad entries / 128 issues max.
 */
export function validateLotMetaField(raw: unknown): LotMetaCheck {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {
      ok: false,
      details: contractSafeParse(z.record(z.string(), z.unknown()), raw).error?.issues.map(
        (issue) => ({ ...issue, path: ["lotMeta", ...issue.path] }),
      ) ?? [],
    };
  }
  const details: ContractDetail[] = [];
  const data: Record<string, { noLot: string; citySlug: string }> = Object.create(null);
  let badEntries = 0;
  for (const key of Object.keys(raw)) {
    const value = (raw as Record<string, unknown>)[key];
    const keyParsed = contractSafeParse(lotMetaKey, key);
    if (!keyParsed.success) {
      for (const issue of keyParsed.error.issues) {
        if (details.length >= MAX_ISSUES) break;
        details.push({ ...issue, path: ["lotMeta", key] });
      }
    }
    const valueParsed = contractSafeParse(lotMetaValue, value);
    if (!valueParsed.success) {
      for (const issue of valueParsed.error.issues) {
        if (details.length >= MAX_ISSUES) break;
        details.push({ ...issue, path: ["lotMeta", key, ...issue.path] });
      }
    }
    const entryOk = keyParsed.success && valueParsed.success;
    if (!entryOk) {
      badEntries += 1;
      if (badEntries >= MAX_BAD_ENTRIES || details.length >= MAX_ISSUES) break;
      continue;
    }
    if (key === "__proto__") continue;
    data[key] = valueParsed.data as { noLot: string; citySlug: string };
  }
  if (details.length > 0) return { ok: false, details: details.slice(0, MAX_ISSUES) };
  return { ok: true, data };
}

export const lotMetaSchema = z.unknown().transform((raw, ctx) => {
  const result = validateLotMetaField(raw);
  if (result.ok) return result.data!;
  for (const detail of result.details ?? []) ctx.addIssue({
    code: "custom", path: detail.path.slice(1), message: detail.message,
    params: { contract: detail },
  });
  return z.NEVER;
});
