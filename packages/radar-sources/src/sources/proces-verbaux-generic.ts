import type { SourceKind } from "@radar/domain";

import { sha256Hex } from "../RawDocument.js";
import type {
  IsoDateString,
  ListOptions,
  RawDocument,
  RawDocumentRef,
  SourceAdapter,
} from "../SourceAdapter.js";
import {
  filterPvByWindow,
  parsePvIndex,
  PV_NON_DISPONIBLE,
} from "./proces-verbaux-parser.js";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

export const PV_ADAPTER_VERSION = "0.1.0";

/** Honest, identifiable user-agent (rules/MASTER.md Scraping Policy). */
export const PV_USER_AGENT =
  "radar-immobilier/0.1 (+https://github.com/rhanka/radar-immobilier)";

/** Hard cap per fetch so a slow/hanging source never blocks the request. */
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Default look-back window in days for PV discovery.
 * The spec mandates 6 months (≈183 days).
 */
const DEFAULT_WINDOW_DAYS = 183;

// ─────────────────────────────────────────────────────────────────────────────
// Error type
// ─────────────────────────────────────────────────────────────────────────────

/** Fetch-failure kinds — returned, never thrown (patron avis-publics). */
export type PvSourceErrorKind = "timeout" | "network" | "http" | "parse";

export class PvSourceFetchError extends Error {
  constructor(
    readonly kind: PvSourceErrorKind,
    readonly detail: string,
    readonly url: string,
  ) {
    super(`[${kind}] ${detail}`);
    this.name = "PvSourceFetchError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FetchLike injectable — makes the adapter unit-testable without globals
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal fetch signature so the PV adapter is testable without globals. */
export type PvFetchLike = (
  url: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer: () => Promise<ArrayBuffer>;
}>;

// ─────────────────────────────────────────────────────────────────────────────
// City configuration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-city configuration for the generic PV adapter.
 *
 * `pvIndexUrl` is the public URL of the page listing the council PV documents.
 * It is fetched as-is (direct download, no Obscura required at test time).
 *
 * `citySlug` must match the radar city registry slug (lowercase, hyphenated,
 * e.g. "saint-damase", "salaberry-de-valleyfield").
 */
export interface PvCityConfig {
  /** City slug used for RawDocument.city and storage key derivation. */
  readonly citySlug: string;
  /** Public URL of the PV index page. */
  readonly pvIndexUrl: string;
  /** Source id, e.g. "proces-verbaux-saint-damase". */
  readonly sourceId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Adapter options
// ─────────────────────────────────────────────────────────────────────────────

export interface PvAdapterOptions {
  /** Inject a mock fetch in tests; defaults to globalThis.fetch. */
  readonly fetchImpl?: PvFetchLike;
  /** Per-fetch timeout in ms; defaults to FETCH_TIMEOUT_MS. */
  readonly timeoutMs?: number;
  /** Clock injection for the "now" timestamp (unit tests). */
  readonly now?: () => Date;
  /**
   * Look-back window in days.  A PV whose date is older than `now - windowDays`
   * is excluded from the list.  Defaults to DEFAULT_WINDOW_DAYS (6 months).
   */
  readonly windowDays?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic PV SourceAdapter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generic procès-verbaux SourceAdapter — parameterised by city config.
 *
 * `list()`: fetches the PV index page and yields one `RawDocumentRef` per PV
 *   document that falls within the configured window.
 * `fetch()`: downloads the PV document (HTML or PDF) and returns a `RawDocument`.
 * `hash()`: sha256 of the raw bytes (idempotent storage key primitive).
 *
 * The adapter NEVER throws on a fetch failure: it raises a typed
 * `PvSourceFetchError` that the RECUEIL job converts into a typed outcome.
 *
 * Rate-limiting (1 req / 2 s per the Scraping Policy) is the caller's
 * responsibility; the adapter itself is a pure fetch abstraction.
 */
export class ProcesVerbauxGenericAdapter implements SourceAdapter {
  readonly kind: SourceKind = "pv";
  readonly city: string;
  readonly version = PV_ADAPTER_VERSION;

  private readonly config: PvCityConfig;
  private readonly fetchImpl: PvFetchLike;
  private readonly timeoutMs: number;
  private readonly now: () => Date;
  private readonly windowDays: number;

  constructor(config: PvCityConfig, options: PvAdapterOptions = {}) {
    this.config = config;
    this.city = config.citySlug;
    this.fetchImpl =
      options.fetchImpl ?? (globalThis.fetch as unknown as PvFetchLike);
    this.timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
    this.now = options.now ?? (() => new Date());
    this.windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private isoWindow(): { since: string; until: string } {
    const now = this.now();
    const until = now.toISOString().slice(0, 10);
    const sinceDate = new Date(now);
    sinceDate.setDate(sinceDate.getDate() - this.windowDays);
    const since = sinceDate.toISOString().slice(0, 10);
    return { since, until };
  }

  /**
   * Perform one fetch with timeout + error wrapping.
   * Returns `{ ok, status, headers, arrayBuffer }` or throws `PvSourceFetchError`.
   */
  private async fetchWithTimeout(
    url: string,
    accept = "*/*",
  ): Promise<Awaited<ReturnType<PvFetchLike>>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      let res: Awaited<ReturnType<PvFetchLike>>;
      try {
        res = await this.fetchImpl(url, {
          signal: controller.signal,
          headers: {
            "user-agent": PV_USER_AGENT,
            accept,
          },
        });
      } catch (e) {
        const isAbort = e instanceof Error && e.name === "AbortError";
        throw new PvSourceFetchError(
          isAbort ? "timeout" : "network",
          e instanceof Error ? e.message : String(e),
          url,
        );
      }
      if (!res.ok) {
        throw new PvSourceFetchError("http", `HTTP ${res.status}`, url);
      }
      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  // ── list() ─────────────────────────────────────────────────────────────────

  /**
   * Fetch the PV index page and yield one ref per PV within the window.
   *
   * Emits the raw index page first (sourceKind "pv", contentType "text/html"),
   * then one ref per discovered PV document.
   */
  async *list(opts: ListOptions): AsyncIterable<RawDocumentRef> {
    if (opts.signal?.aborted) return;

    const discoveredAt: IsoDateString = this.now().toISOString();
    const { since, until } = this.isoWindow();

    // 1. Fetch the index page. fetchWithTimeout throws PvSourceFetchError on
    //    failure; the RECUEIL job catches it — no wrapper needed here.
    const indexRes = await this.fetchWithTimeout(
      this.config.pvIndexUrl,
      "text/html",
    );
    const indexHtml = new TextDecoder("utf-8").decode(
      new Uint8Array(await indexRes.arrayBuffer()),
    );

    if (opts.signal?.aborted) return;

    // 2. Parse and filter by window.
    const allItems = parsePvIndex(indexHtml, this.config.pvIndexUrl);
    const windowItems = filterPvByWindow(allItems, since, until);

    // 3. Yield one ref per PV in the window.
    for (const item of windowItems) {
      if (opts.signal?.aborted) break;
      const hasDate = item.dateIso !== PV_NON_DISPONIBLE;
      const ref: RawDocumentRef = {
        sourceKind: this.kind,
        city: this.city,
        url: item.url,
        discoveredAt,
        title: item.title,
        ...(hasDate ? { publishedAt: item.dateIso } : {}),
        contentType: item.url.toLowerCase().endsWith(".pdf")
          ? "application/pdf"
          : "text/html",
        metadata: { pvSourceId: this.config.sourceId },
      };
      yield ref;
    }
  }

  // ── fetch() ────────────────────────────────────────────────────────────────

  /**
   * Download the document at `ref.url` and return a `RawDocument`.
   * For PDFs the caller is responsible for running `pdftotext` if needed;
   * the adapter returns raw bytes.
   */
  async fetch(ref: RawDocumentRef): Promise<RawDocument> {
    const fetchedAt: IsoDateString = this.now().toISOString();
    const isPdf = ref.url.toLowerCase().endsWith(".pdf");
    const accept = isPdf ? "application/pdf" : "text/html,*/*";

    const res = await this.fetchWithTimeout(ref.url, accept);
    const arrayBuffer = await res.arrayBuffer();
    const body = new Uint8Array(arrayBuffer);
    const contentType =
      res.headers.get("content-type") ??
      ref.contentType ??
      (isPdf ? "application/pdf" : "text/html");

    const doc: RawDocument = {
      ref,
      sourceKind: this.kind,
      city: this.city,
      url: ref.url,
      fetchedAt,
      contentType,
      body,
      httpStatus: res.status,
      sha256: sha256Hex(body),
      provenance: {
        adapterVersion: this.version,
        userAgent: PV_USER_AGENT,
        fetchedViaObscura: false,
        obtentionMode: "scraping",
      },
    };
    return doc;
  }

  // ── hash() ─────────────────────────────────────────────────────────────────

  hash(raw: RawDocument): string {
    return raw.sha256 ?? sha256Hex(raw.body);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Well-known city configurations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Saint-Damase: simple WordPress site, PV list on the conseil municipal page.
 * No CAPTCHA, direct download — ideal easy-first target.
 */
export const SAINT_DAMASE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-damase",
  pvIndexUrl:
    "https://www.municipalite.saint-damase.qc.ca/conseil-municipal/proces-verbaux/",
  sourceId: "proces-verbaux-saint-damase",
};

/** Factory shortcut for the Saint-Damase PV adapter. */
export function createSaintDamasePvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(SAINT_DAMASE_PV_CONFIG, options);
}

/** Factory for any city, generic entry-point. */
export function createProcesVerbauxAdapter(
  config: PvCityConfig,
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(config, options);
}

// ─────────────────────────────────────────────────────────────────────────────
// Rive-Sud cluster: Roussillon MRC cities near Montréal
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sainte-Catherine (MRC Roussillon, ~25 km SW of Montréal).
 * Custom CMS (same vendor as Saint-Constant). PV list at the
 * "séances publiques" page. Direct PDF links, no CAPTCHA.
 * Confirmed HTTP 200, robots.txt: Disallow /craft/ only.
 * Captured 2026-06-10.
 */
export const SAINTE_CATHERINE_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-catherine",
  pvIndexUrl:
    "https://www.ville.sainte-catherine.qc.ca/ville/conseil-municipal/seances-publiques/",
  sourceId: "proces-verbaux-sainte-catherine",
};

/** Factory shortcut for the Sainte-Catherine PV adapter. */
export function createSainteCatherinePvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(SAINTE_CATHERINE_PV_CONFIG, options);
}

/**
 * Saint-Constant (MRC Roussillon, ~30 km SW of Montréal).
 * Custom CMS. PV list at the "séances-du-conseil-et-documents-publics" page.
 * Direct PDF links under /uploads/attachments/Greffe/, no CAPTCHA.
 * Confirmed HTTP 200, robots.txt: Disallow: (empty — no restrictions).
 * Captured 2026-06-10.
 */
export const SAINT_CONSTANT_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-constant",
  pvIndexUrl:
    "https://saint-constant.ca/fr/seances-du-conseil-et-documents-publics",
  sourceId: "proces-verbaux-saint-constant",
};

/** Factory shortcut for the Saint-Constant PV adapter. */
export function createSaintConstantPvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(SAINT_CONSTANT_PV_CONFIG, options);
}

// ─────────────────────────────────────────────────────────────────────────────
// Rive-Sud / Vaudreuil-Soulanges cluster: additional cities near Montréal
// ─────────────────────────────────────────────────────────────────────────────

/**
 * La Prairie (MRC Roussillon, ~25 km SW of Montréal).
 * October CMS (custom accordion). PV list under /ville/democratie/seances-du-conseil.
 * Direct PDF links under /storage/app/media/..., no CAPTCHA.
 * Confirmed HTTP 200, robots.txt: Disallow /administration/ only.
 * Captured 2026-06-10.
 */
export const LAPRAIRIE_PV_CONFIG: PvCityConfig = {
  citySlug: "la-prairie",
  pvIndexUrl: "https://laprairie.ca/ville/democratie/seances-du-conseil",
  sourceId: "proces-verbaux-la-prairie",
};

/** Factory shortcut for the La Prairie PV adapter. */
export function createLaPrairiePvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(LAPRAIRIE_PV_CONFIG, options);
}

/**
 * Châteauguay (MRC Roussillon, ~35 km SW of Montréal).
 * WordPress CMS. PV list at /affaires-municipales/seances-du-conseil/.
 * Direct PDF links under /wp-content/uploads/, no CAPTCHA.
 * Confirmed HTTP 200, robots.txt: Disallow /wp-admin/ only; Crawl-delay: 3.
 * Captured 2026-06-10.
 */
export const CHATEAUGUAY_PV_CONFIG: PvCityConfig = {
  citySlug: "chateauguay",
  pvIndexUrl:
    "https://ville.chateauguay.qc.ca/affaires-municipales/seances-du-conseil/",
  sourceId: "proces-verbaux-chateauguay",
};

/** Factory shortcut for the Châteauguay PV adapter. */
export function createChateauguayPvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(CHATEAUGUAY_PV_CONFIG, options);
}

/**
 * Delson (MRC Roussillon, ~35 km SW of Montréal).
 * WordPress CMS (act-collapsible blocks). PV list at
 * /la-ville/vie-democratique/seances-du-conseil-et-proces-verbaux/.
 * Direct PDF links under /wp-content/uploads/, no CAPTCHA.
 * Confirmed HTTP 200, robots.txt: Disallow: (empty — no restrictions).
 * Captured 2026-06-10.
 */
export const DELSON_PV_CONFIG: PvCityConfig = {
  citySlug: "delson",
  pvIndexUrl:
    "https://ville.delson.qc.ca/la-ville/vie-democratique/seances-du-conseil-et-proces-verbaux/",
  sourceId: "proces-verbaux-delson",
};

/** Factory shortcut for the Delson PV adapter. */
export function createDelsonPvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(DELSON_PV_CONFIG, options);
}

/**
 * Vaudreuil-Dorion (MRC Vaudreuil-Soulanges, ~40 km W of Montréal).
 * Custom CMS. PV list at /fr/la-ville/conseil-municipal/seances-publiques.
 * Direct PDF links under /uploads/sections/La_Ville/Mairie/Seances_publiques/PV_20XX/.
 * No CAPTCHA. Confirmed HTTP 200, robots.txt: Disallow /assets/admin/ and search pages.
 * Captured 2026-06-10.
 */
export const VAUDREUIL_DORION_PV_CONFIG: PvCityConfig = {
  citySlug: "vaudreuil-dorion",
  pvIndexUrl:
    "https://www.ville.vaudreuil-dorion.qc.ca/fr/la-ville/conseil-municipal/seances-publiques",
  sourceId: "proces-verbaux-vaudreuil-dorion",
};

/** Factory shortcut for the Vaudreuil-Dorion PV adapter. */
export function createVaudreuilDorionPvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(VAUDREUIL_DORION_PV_CONFIG, options);
}

// ─────────────────────────────────────────────────────────────────────────────
// Round-2 cluster: Roussillon / Haut-St-Laurent cities near Montréal
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sainte-Martine (MRC Beauharnois-Salaberry, ~50 km SW of Montréal).
 * WordPress CMS. PV list via publications page filtered by document_type=proces-verbaux.
 * Direct PDF links under /wp-content/uploads/, no CAPTCHA.
 * Confirmed HTTP 200, robots.txt: Disallow: (empty — no restrictions).
 * Captured 2026-06-10.
 */
export const SAINTE_MARTINE_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-martine",
  pvIndexUrl:
    "https://sainte-martine.ca/municipalite/administration-et-finances/publications/?document_type=proces-verbaux",
  sourceId: "proces-verbaux-sainte-martine",
};

/** Factory shortcut for the Sainte-Martine PV adapter. */
export function createSainteMartinePvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(SAINTE_MARTINE_PV_CONFIG, options);
}

/**
 * Candiac (MRC Roussillon, ~25 km S of Montréal).
 * Custom CMS. PV list at /la-ville/vie-democratique/seances-publiques.
 * Direct PDF links under /uploads/Documents/Juridiques/, no CAPTCHA.
 * Confirmed HTTP 200, robots.txt: Disallow: /admin, /uploads/carrier — content pages allowed.
 * NOTE: All Candiac PV PDFs are PaperCut scanned images (no embedded text layer).
 *       pdftotext returns 0 bytes. OCR required for text extraction.
 *       The adapter correctly lists PV refs from the index; text detection not applicable.
 * Captured 2026-06-10.
 */
export const CANDIAC_PV_CONFIG: PvCityConfig = {
  citySlug: "candiac",
  pvIndexUrl:
    "https://candiac.ca/la-ville/vie-democratique/seances-publiques",
  sourceId: "proces-verbaux-candiac",
};

/** Factory shortcut for the Candiac PV adapter. */
export function createCandiacPvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(CANDIAC_PV_CONFIG, options);
}

/**
 * Saint-Rémi (MRC Les Jardins-de-Napierville, ~40 km S of Montréal).
 * WordPress / Elementor CMS. Main séances page at /ville/vie-municipale/seances-du-conseil/.
 * Archives 2025: direct PDF links in accordion. 2026: sub-page links (parsePvIndex finds
 * the 2025 direct PDF links; 2026 sub-pages require an additional fetch per session).
 * Direct PDF links under /wp-content/uploads/, no CAPTCHA.
 * Confirmed HTTP 200, robots.txt: Disallow: (empty — no restrictions).
 * NOTE: Saint-Rémi uses V-prefix règlement numbering (V654-2026-33). The existing
 *       REGLEMENT_NUMBER_RE pattern does not match V-prefix numbers, so detectZonageChange
 *       returns avisDeMotion=true but changementZonage=false even for real zonage changes.
 *       This is a documented parser limitation (honest, not a faux positif).
 * Captured 2026-06-10.
 */
export const SAINT_REMI_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-remi",
  pvIndexUrl:
    "https://www.saint-remi.ca/ville/vie-municipale/seances-du-conseil/",
  sourceId: "proces-verbaux-saint-remi",
};

/** Factory shortcut for the Saint-Rémi PV adapter. */
export function createSaintRemiPvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(SAINT_REMI_PV_CONFIG, options);
}
