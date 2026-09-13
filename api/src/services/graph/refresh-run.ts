import { createHash } from "node:crypto";

import type { ObjectStore } from "../../storage/object-store.js";
import {
  runLiveScrape,
  type LiveScrapeCityRecap,
  type RunLiveScrapeOptions,
} from "../sources/live-scrape.js";

export type RefreshAcquire = (
  cities: readonly string[] | undefined,
  options: RunLiveScrapeOptions,
) => Promise<LiveScrapeCityRecap[]>;

export interface AcquireRefreshPdfOptions {
  readonly citySlug: string;
  readonly store: ObjectStore;
  readonly signal?: AbortSignal;
  readonly acquire?: RefreshAcquire;
}

export interface RefreshPdfSelection {
  readonly manifestKey: string;
  readonly recap: LiveScrapeCityRecap;
}

const MANIFEST_HEADER = "source_id\tcity_slug\tsha\trepresentation_key\tsidecar_key";
const SHA256 = /^[0-9a-f]{64}$/;

/** Convert one successful existing RECUEIL result into C04's immutable PDF selection. */
export async function acquireRefreshPdfManifest(
  options: AcquireRefreshPdfOptions,
): Promise<RefreshPdfSelection> {
  const acquire = options.acquire ?? runLiveScrape;
  const recaps = await acquire([options.citySlug], {
    store: options.store,
    exploit: false,
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  });
  if (options.signal?.aborted) throw new Error("Refresh aborted after acquisition");
  const recap = recaps[0];
  if (recaps.length !== 1 || !recap || recap.city !== options.citySlug
    || recap.status === "error" || recap.count < 1 || recap.casKeys.length !== recap.count) {
    throw new Error(`Selected city acquisition failed: ${options.citySlug}`);
  }
  if (!recap.sourceId || /[\t\n]/.test(recap.sourceId)) {
    throw new Error(`Invalid selected source id: ${options.citySlug}`);
  }
  const prefix = `raw/${recap.sourceId}/cas/`;
  const rows = [...recap.casKeys].sort().map((key) => {
    const sha = key.startsWith(prefix) && key.endsWith(".pdf")
      ? key.slice(prefix.length, -4)
      : "";
    if (!SHA256.test(sha)) throw new Error(`Selected city input is not an exact PDF: ${key}`);
    return `${recap.sourceId}\t${recap.city}\t${sha}\t${key}\t${key}.meta.json`;
  });
  const body = `${MANIFEST_HEADER}\n${rows.join("\n")}\n`;
  const digest = createHash("sha256").update(body).digest("hex");
  const manifestKey = `refresh/018/${options.citySlug}/inputs/${digest}.tsv`;
  await options.store.put(manifestKey, body, "text/tab-separated-values");
  return { manifestKey, recap };
}
