import type { SourceKind } from "@radar/domain";

import { sha256Hex } from "../../../RawDocument.js";
import type {
  IsoDateString,
  ListOptions,
  RawDocument,
  RawDocumentRef,
  SourceAdapter,
} from "../../../SourceAdapter.js";

/**
 * Spike-only fallback adapter for the direct official PDF URLs.
 *
 * The official listing page is Cloudflare-protected, so this deliberately
 * does not pretend to scrape an index. Replace the manifest with an approved
 * feed/index adapter when Terrebonne exposes one.
 */
export class TerrebonnePvSpikeAdapter implements SourceAdapter {
  readonly kind: SourceKind = "pv";
  readonly city = "terrebonne";
  readonly version = "spike-0.1.0";

  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly now: () => Date;

  constructor(options: { fetchImpl?: typeof globalThis.fetch; now?: () => Date } = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.now = options.now ?? (() => new Date());
  }

  async *list(opts: ListOptions): AsyncIterable<RawDocumentRef> {
    if (opts.signal?.aborted) return;

    const discoveredAt: IsoDateString = this.now().toISOString();
    const entries = [
      {
        title: "Procès-verbal du conseil municipal — 2024-01-30",
        url: "https://terrebonne.ca/wp-content/uploads/2024/04/00-Proces-verbal-CM-2024-01-30.pdf",
        publishedAt: "2024-01-30",
      },
      {
        title: "Procès-verbal du conseil municipal — 2025-04-15",
        url: "https://terrebonne.ca/wp-content/uploads/2025/04/PV-CM-2025-04-15.pdf",
        publishedAt: "2025-04-15",
      },
      {
        title: "Procès-verbal du conseil municipal — 2026-01-20",
        url: "https://terrebonne.ca/wp-content/uploads/2026/01/PV_CM_2026_01_20.pdf",
        publishedAt: "2026-01-20",
      },
      {
        title: "Procès-verbal du conseil municipal — 2026-02-17",
        url: "https://terrebonne.ca/wp-content/uploads/2026/02/PV_CM_2026-02-17.pdf",
        publishedAt: "2026-02-17",
      },
    ];

    for (const entry of entries) {
      if (opts.signal?.aborted) return;
      yield {
        sourceKind: this.kind,
        city: this.city,
        url: entry.url,
        discoveredAt,
        title: entry.title,
        publishedAt: entry.publishedAt,
        contentType: "application/pdf",
        metadata: {
          pvSourceId: "proces-verbaux-terrebonne",
          discovery: "direct-public-url-manifest",
        },
      };
    }
  }

  async fetch(ref: RawDocumentRef): Promise<RawDocument> {
    const response = await this.fetchImpl(ref.url, {
      headers: {
        accept: "application/pdf",
        "user-agent": "radar-immobilier/0.1 (+contact)",
      },
    });
    const body = new Uint8Array(await response.arrayBuffer());
    const fetchedAt = this.now().toISOString();

    return {
      ref,
      sourceKind: this.kind,
      city: this.city,
      url: ref.url,
      fetchedAt,
      contentType: response.headers.get("content-type") ?? "application/pdf",
      body,
      httpStatus: response.status,
      sha256: sha256Hex(body),
      provenance: {
        adapterVersion: this.version,
        userAgent: "radar-immobilier/0.1 (+contact)",
        fetchedViaObscura: false,
        obtentionMode: "scraping",
      },
    };
  }

  hash(raw: RawDocument): string {
    return raw.sha256 ?? sha256Hex(raw.body);
  }
}
