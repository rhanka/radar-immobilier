/**
 * Append-only repair for legacy raw document metadata.
 *
 * Older CAS sidecars may lack `publishedAt` because the adapter ref carried it
 * only transiently. This repair does not rewrite raw objects or legacy
 * `.meta.json` files. It emits a synthetic run manifest under
 * `runs/zz-repair-published-at/{runId}/manifest.jsonl`, which the S3 rebuild
 * path already consumes as the valid-time index.
 */

import { RawDocumentRecordSchema, type RawDocumentRecord } from "@radar/sources";

import type { ObjectStore } from "../../storage/object-store.js";
import type { RunManifestEntry } from "./run-manifest.js";
import { writeRunManifest } from "./run-manifest.js";

const RAW_PREFIX = "raw/";
const RUNS_PREFIX = "runs/";
const META_SUFFIX = ".meta.json";
const MANIFEST_SUFFIX = "manifest.jsonl";

export const PUBLISHED_AT_REPAIR_SOURCE = "zz-repair-published-at";

export interface PublishedAtRepairSummary {
  readonly scannedDocuments: number;
  readonly alreadyDated: number;
  readonly repairedFromManifest: number;
  readonly repairedFromUrlOrTitle: number;
  readonly unrepaired: number;
  readonly skippedAlreadyRepaired: number;
  readonly writtenEntries: number;
  readonly manifestKey?: string;
}

const decoder = new TextDecoder();

function tryParseJson(bytes: Uint8Array): unknown | null {
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch {
    return null;
  }
}

function decodePathText(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function isValidIsoDate(year: string, month: string, day: string): boolean {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

function normalizeIsoDate(year: string, month: string, day: string): string | undefined {
  return isValidIsoDate(year, month, day)
    ? `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`
    : undefined;
}

const FRENCH_MONTHS: Record<string, string> = {
  janvier: "01",
  fevrier: "02",
  février: "02",
  mars: "03",
  avril: "04",
  mai: "05",
  juin: "06",
  juillet: "07",
  aout: "08",
  août: "08",
  septembre: "09",
  octobre: "10",
  novembre: "11",
  decembre: "12",
  décembre: "12",
};

function extractConservativePublishedAt(record: RawDocumentRecord): string | undefined {
  const texts = [record.title, record.sourceUrl]
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => decodePathText(v).toLowerCase());

  for (const text of texts) {
    const iso = text.match(/\b(20\d{2})[-_/](0?[1-9]|1[0-2])[-_/](0?[1-9]|[12]\d|3[01])\b/);
    if (iso?.[1] && iso[2] && iso[3]) {
      const normalized = normalizeIsoDate(iso[1], iso[2], iso[3]);
      if (normalized) return normalized;
    }

    const compact = text.match(/\b(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\b/);
    if (compact?.[1] && compact[2] && compact[3]) {
      const normalized = normalizeIsoDate(compact[1], compact[2], compact[3]);
      if (normalized) return normalized;
    }

    const french = text.match(
      /\b(\d{1,2})(?:er|re|e|ère|ème)?\s+([a-zàâçéèêëîïôûù]+)\s+(20\d{2})\b/i,
    );
    if (french?.[1] && french[2] && french[3]) {
      const month = FRENCH_MONTHS[french[2]];
      if (month) {
        const normalized = normalizeIsoDate(french[3], month, french[1]);
        if (normalized) return normalized;
      }
    }
  }

  if (!record.source.startsWith("proces-verbaux-")) return undefined;

  for (const text of texts) {
    if (!/\b(pv|proces|procès|verbal|seance|séance)\b/.test(text)) continue;

    const monthYear = text.match(/\b([a-zàâçéèêëîïôûù]+)\s+(20\d{2})\b/i);
    if (monthYear?.[1] && monthYear[2]) {
      const month = FRENCH_MONTHS[monthYear[1]];
      if (month) return `${monthYear[2]}-${month}`;
    }

    const yearMonth = text.match(/\b(20\d{2})[-_/](0[1-9]|1[0-2])\b/);
    if (yearMonth?.[1] && yearMonth[2]) return `${yearMonth[1]}-${yearMonth[2]}`;
  }

  return undefined;
}

async function indexManifestDates(store: ObjectStore): Promise<{
  publishedByCasKey: Map<string, string>;
  alreadyRepairedCasKeys: Set<string>;
}> {
  const publishedByCasKey = new Map<string, string>();
  const alreadyRepairedCasKeys = new Set<string>();
  const keys = (await store.list?.(RUNS_PREFIX)) ?? [];
  const manifestKeys = keys.filter((k) => k.endsWith(MANIFEST_SUFFIX)).sort();

  for (const key of manifestKeys) {
    const bytes = await store.get(key);
    const isRepairManifest = key.startsWith(`runs/${PUBLISHED_AT_REPAIR_SOURCE}/`);

    for (const line of decoder.decode(bytes).split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;

      let entry: Partial<RunManifestEntry>;
      try {
        entry = JSON.parse(trimmed) as Partial<RunManifestEntry>;
      } catch {
        continue;
      }

      if (entry.casKey && isRepairManifest) {
        alreadyRepairedCasKeys.add(entry.casKey);
      }
      if (entry.casKey && entry.publishedAt && !isRepairManifest) {
        publishedByCasKey.set(entry.casKey, entry.publishedAt);
      }
    }
  }

  return { publishedByCasKey, alreadyRepairedCasKeys };
}

export async function repairPublishedAtFromS3(
  store: ObjectStore,
  params: { runId: string },
): Promise<PublishedAtRepairSummary> {
  const { publishedByCasKey, alreadyRepairedCasKeys } = await indexManifestDates(store);
  const keys = (await store.list?.(RAW_PREFIX)) ?? [];
  const metaKeys = keys.filter((k) => k.endsWith(META_SUFFIX)).sort();
  const entries: RunManifestEntry[] = [];

  let scannedDocuments = 0;
  let alreadyDated = 0;
  let repairedFromManifest = 0;
  let repairedFromUrlOrTitle = 0;
  let unrepaired = 0;
  let skippedAlreadyRepaired = 0;

  for (const metaKey of metaKeys) {
    const parsed = RawDocumentRecordSchema.safeParse(tryParseJson(await store.get(metaKey)));
    if (!parsed.success) continue;

    scannedDocuments += 1;
    const record = parsed.data;
    if (record.publishedAt !== undefined) {
      alreadyDated += 1;
      continue;
    }

    if (alreadyRepairedCasKeys.has(record.storageKey)) {
      skippedAlreadyRepaired += 1;
      continue;
    }

    const fromManifest = publishedByCasKey.get(record.storageKey);
    const publishedAt = fromManifest ?? extractConservativePublishedAt(record);
    if (publishedAt === undefined) {
      unrepaired += 1;
      continue;
    }

    if (fromManifest !== undefined) {
      repairedFromManifest += 1;
    } else {
      repairedFromUrlOrTitle += 1;
    }

    entries.push({
      sha256: record.sha256,
      sourceUrl: record.sourceUrl,
      casKey: record.storageKey,
      status: "seen",
      publishedAt,
    });
  }

  if (entries.length === 0) {
    return {
      scannedDocuments,
      alreadyDated,
      repairedFromManifest,
      repairedFromUrlOrTitle,
      unrepaired,
      skippedAlreadyRepaired,
      writtenEntries: 0,
    };
  }

  const manifestKey = await writeRunManifest(store, {
    source: PUBLISHED_AT_REPAIR_SOURCE,
    runId: params.runId,
    entries,
  });

  return {
    scannedDocuments,
    alreadyDated,
    repairedFromManifest,
    repairedFromUrlOrTitle,
    unrepaired,
    skippedAlreadyRepaired,
    writtenEntries: entries.length,
    manifestKey,
  };
}

