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
// ALL_PV_CITIES — single source of truth for generic PV city wiring
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One city entry in the generic PV city registry.
 *
 * `config`    — PvCityConfig (citySlug + pvIndexUrl + sourceId).
 * `pvText`    — Real pdftotext excerpt used by pv-seed (no network needed).
 * `sourceUrl` — Public URL of the real PV PDF (provenance, never re-fetched).
 */
export interface PvCityEntry {
  readonly config: PvCityConfig;
  /** Real pdftotext excerpt used by pv-seed to seed the object-store. */
  readonly pvText: string;
  /** Public URL of the original PV PDF (provenance). */
  readonly sourceUrl: string;
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

// ─────────────────────────────────────────────────────────────────────────────
// Round-3 cluster: Vallée-du-Richelieu / Marguerite-D'Youville cities near MTL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * McMasterville (MRC Vallée-du-Richelieu, ~25 km SE of Montréal).
 * WordPress + Visual Composer CMS. PV list at /mairie/seances-du-conseil/.
 * Panels (vc_tta-accordion) with sc_button PDF links for Procès-verbal + ODJ + Vidéo.
 * Direct PDF links under /wp-content/uploads/, no CAPTCHA.
 * Confirmed HTTP 200, robots.txt: Disallow: (empty — no restrictions).
 * Captured 2026-06-10.
 */
export const MCMASTERVILLE_PV_CONFIG: PvCityConfig = {
  citySlug: "mcmasterville",
  pvIndexUrl: "https://www.mcmasterville.ca/mairie/seances-du-conseil/",
  sourceId: "proces-verbaux-mcmasterville",
};

/** Factory shortcut for the McMasterville PV adapter. */
export function createMcmastervillePvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(MCMASTERVILLE_PV_CONFIG, options);
}

/**
 * Beloeil (MRC La Vallée-du-Richelieu, ~30 km SE of Montréal).
 * WordPress + Elementor CMS. PV list at /mairie/seances-du-conseil/.
 * Elementor accordion: 2026 individual sessions + compiled 2025/2024 PDFs.
 * Direct PDF links under /wp-content/uploads/, no CAPTCHA.
 * Confirmed HTTP 200, robots.txt: Disallow: (empty — no restrictions, Yoast sitemap).
 * Captured 2026-06-10.
 */
export const BELOEIL_PV_CONFIG: PvCityConfig = {
  citySlug: "beloeil",
  pvIndexUrl: "https://www.beloeil.ca/mairie/seances-du-conseil/",
  sourceId: "proces-verbaux-beloeil",
};

/** Factory shortcut for the Beloeil PV adapter. */
export function createBeloeilPvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(BELOEIL_PV_CONFIG, options);
}

/**
 * Sainte-Julie (MRC Marguerite-D'Youville, ~30 km SE of Montréal).
 * Custom CMS (saintejulie.ca). PV list at /administration/seances-publiques.
 * Custom accordeon structure with direct PDF links under /uploads/html_content/Séances publiques/.
 * No CAPTCHA. Confirmed HTTP 200, robots.txt: 404 (no restrictions file; permissive by default).
 * Captured 2026-06-10.
 */
export const SAINTE_JULIE_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-julie",
  pvIndexUrl: "https://saintejulie.ca/administration/seances-publiques",
  sourceId: "proces-verbaux-sainte-julie",
};

/** Factory shortcut for the Sainte-Julie PV adapter. */
export function createSainteJuliePvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(SAINTE_JULIE_PV_CONFIG, options);
}

// ─────────────────────────────────────────────────────────────────────────────
// Basses-Laurentides cluster: cities north of Montréal (MRC Thérèse-De Blainville,
// MRC Deux-Montagnes, Laurentides MRC)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sainte-Thérèse (MRC Thérèse-De Blainville, ~30 km N of Montréal).
 * October CMS (same as La Prairie / Blainville). PV list at
 * /la-ville/democratie/seances-du-conseil/.
 * Direct PDF links under /storage/app/media/ville/democratie/seances-du-conseil/proces-verbaux/.
 * No CAPTCHA. Confirmed HTTP 200, robots.txt: Disallow /administration, /administration/backend only.
 * Captured 2026-06-10.
 */
export const SAINTE_THERESE_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-therese",
  pvIndexUrl:
    "https://www.sainte-therese.ca/la-ville/democratie/seances-du-conseil/",
  sourceId: "proces-verbaux-sainte-therese",
};

/** Factory shortcut for the Sainte-Thérèse PV adapter. */
export function createSainteTheresePvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(SAINTE_THERESE_PV_CONFIG, options);
}

/**
 * Deux-Montagnes (MRC Deux-Montagnes, ~40 km NW of Montréal).
 * October CMS (same as La Prairie). PV list at
 * /ville-de-deux-montagnes/vie-democratique/seances-du-conseil-municipal.
 * Direct PDF links under /storage/app/media/ville-de-deux-montagnes/vie-democratique/.
 * No CAPTCHA. Confirmed HTTP 200, robots.txt: Disallow /administration, /administration/backend only.
 * Captured 2026-06-10.
 */
export const DEUX_MONTAGNES_PV_CONFIG: PvCityConfig = {
  citySlug: "deux-montagnes",
  pvIndexUrl:
    "https://www.ville.deux-montagnes.qc.ca/ville-de-deux-montagnes/vie-democratique/seances-du-conseil-municipal",
  sourceId: "proces-verbaux-deux-montagnes",
};

/** Factory shortcut for the Deux-Montagnes PV adapter. */
export function createDeuxMontagnePvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(DEUX_MONTAGNES_PV_CONFIG, options);
}

/**
 * Mirabel (MRC Mirabel, ~50 km NW of Montréal — largest city in Laurentides).
 * Custom CMS (mirabel.ca). PV list at /seances-conseil.
 * Custom table layout with direct PDF links under /uploads/.
 * No CAPTCHA. Confirmed HTTP 200, robots.txt: Disallow: (empty — no restrictions).
 * Captured 2026-06-10.
 */
export const MIRABEL_PV_CONFIG: PvCityConfig = {
  citySlug: "mirabel",
  pvIndexUrl: "https://mirabel.ca/seances-conseil",
  sourceId: "proces-verbaux-mirabel",
};

/** Factory shortcut for the Mirabel PV adapter. */
export function createMirabelPvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(MIRABEL_PV_CONFIG, options);
}

/**
 * Saint-Eustache (MRC Deux-Montagnes, ~40 km NW of Montréal).
 * October CMS (same as Sainte-Thérèse / La Prairie). PV list at
 * /ville/vie-democratique/seances-du-conseil.
 * NOTE: Saint-Eustache publishes PV as ANNUAL compiled documents (2026PV_internet.pdf,
 * 2025PV_internet.pdf, etc.) — one file per year. The parsePvIndex finds the links but
 * cannot extract individual session dates from the compiled-document filenames.
 * No CAPTCHA. Confirmed HTTP 200, robots.txt: Disallow /administration, /administration/backend only.
 * Captured 2026-06-10.
 */
export const SAINT_EUSTACHE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-eustache",
  pvIndexUrl:
    "https://www.saint-eustache.ca/ville/vie-democratique/seances-du-conseil",
  sourceId: "proces-verbaux-saint-eustache",
};

/** Factory shortcut for the Saint-Eustache PV adapter. */
export function createSaintEustachePvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(SAINT_EUSTACHE_PV_CONFIG, options);
}

// ─────────────────────────────────────────────────────────────────────────────
// Lanaudière cluster: couronne nord-est de Montréal (MRC Les Moulins, L'Assomption,
// D'Autray) — villes à ~40–60 km NE de Montréal
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mascouche (MRC Les Moulins, ~40 km NE de Montréal).
 * October CMS. PV index at /ville/vie-democratique/seances-du-conseil.
 * One compiled PDF per year (all sessions in one file).
 * Direct PDF links under /storage/app/media/, no CAPTCHA.
 * Confirmed HTTP 200, robots.txt: 404 (no restrictions file — permissive by default).
 * Captured 2026-06-10.
 */
export const MASCOUCHE_PV_CONFIG: PvCityConfig = {
  citySlug: "mascouche",
  pvIndexUrl:
    "https://mascouche.ca/ville/vie-democratique/seances-du-conseil",
  sourceId: "proces-verbaux-mascouche",
};

/** Factory shortcut for the Mascouche PV adapter. */
export function createMascouchePvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(MASCOUCHE_PV_CONFIG, options);
}

/**
 * Charlemagne (MRC Les Moulins, ~40 km NE de Montréal).
 * October CMS. PV index at /la-ville/vie-democratique/seances-du-conseil.
 * One PDF per month, class="small-document" anchor links.
 * Direct PDF links under /storage/app/media/la-ville/Séances du conseil/, no CAPTCHA.
 * Confirmed HTTP 200, robots.txt: 404 (no restrictions file — permissive by default).
 * Captured 2026-06-10.
 */
export const CHARLEMAGNE_PV_CONFIG: PvCityConfig = {
  citySlug: "charlemagne",
  pvIndexUrl:
    "https://www.charlemagne.ca/la-ville/vie-democratique/seances-du-conseil",
  sourceId: "proces-verbaux-charlemagne",
};

/** Factory shortcut for the Charlemagne PV adapter. */
export function createCharlemagnePvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(CHARLEMAGNE_PV_CONFIG, options);
}

/**
 * L'Assomption (MRC L'Assomption, ~45 km NE de Montréal).
 * Custom CMS (Bootstrap 3 accordion). PV index at /seances-conseil/.
 * Individual PV PDFs per session via download.php?filename= relative links.
 * Confirmed HTTP 200 (301 redirect from ville.lassomption.qc.ca),
 * robots.txt: User-agent: * / Sitemap only — NO Disallow rules.
 * Captured 2026-06-10.
 */
export const LASSOMPTION_PV_CONFIG: PvCityConfig = {
  citySlug: "lassomption",
  pvIndexUrl:
    "https://www.ville.lassomption.qc.ca/seances-conseil/",
  sourceId: "proces-verbaux-lassomption",
};

/** Factory shortcut for the L'Assomption PV adapter. */
export function createLAssomptionPvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(LASSOMPTION_PV_CONFIG, options);
}

/**
 * Lavaltrie (MRC D'Autray, ~60 km NE de Montréal).
 * October / Byscuit CMS. PV index at /conseil-municipal/seances-du-conseil-et-proces-verbaux.
 * Individual PDFs per session via fr-file relative links under /storage/app/media/.
 * Confirmed HTTP 200 (301 redirect from lavaltrie.ca),
 * robots.txt: 404 (permissive by default).
 * Captured 2026-06-10.
 */
export const LAVALTRIE_PV_CONFIG: PvCityConfig = {
  citySlug: "lavaltrie",
  pvIndexUrl:
    "https://www.ville.lavaltrie.qc.ca/conseil-municipal/seances-du-conseil-et-proces-verbaux",
  sourceId: "proces-verbaux-lavaltrie",
};

/** Factory shortcut for the Lavaltrie PV adapter. */
export function createLavaltrieAdvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(LAVALTRIE_PV_CONFIG, options);
}

// ─────────────────────────────────────────────────────────────────────────────
// ALL_PV_CITIES — single source of truth for generic PV city wiring
// ─────────────────────────────────────────────────────────────────────────────

// Lazy imports so this module stays importable without pulling fixture text in
// production (tree-shaking eliminates the strings when they are unused).
import { PV_SAINT_DAMASE_2025_05_POSITIVE } from "./proces-verbaux-saint-damase.fixture.js";
import {
  PV_SAINT_CONSTANT_2026_05_TEXT,
} from "./proces-verbaux-saint-constant.fixture.js";
import {
  PV_SAINTE_CATHERINE_2026_05_TEXT,
} from "./proces-verbaux-sainte-catherine.fixture.js";
import {
  PV_LAPRAIRIE_2026_05_TEXT,
} from "./proces-verbaux-laprairie.fixture.js";
import {
  PV_CHATEAUGUAY_2026_02_TEXT,
} from "./proces-verbaux-chateauguay.fixture.js";
import {
  PV_DELSON_2026_05_TEXT,
} from "./proces-verbaux-delson.fixture.js";
import {
  PV_VAUDREUIL_DORION_2026_05_TEXT,
} from "./proces-verbaux-vaudreuil-dorion.fixture.js";
import {
  PV_SAINTE_MARTINE_2026_04_TEXT,
} from "./proces-verbaux-sainte-martine.fixture.js";
import {
  PV_SAINT_REMI_2026_04_TEXT,
} from "./proces-verbaux-saint-remi.fixture.js";
import {
  PV_MCMASTERVILLE_2025_11_TEXT,
} from "./proces-verbaux-mcmasterville.fixture.js";
import {
  PV_BELOEIL_2026_02_TEXT,
} from "./proces-verbaux-beloeil.fixture.js";
import {
  PV_SAINTE_JULIE_2026_03_TEXT,
} from "./proces-verbaux-sainte-julie.fixture.js";
import {
  PV_SAINTE_THERESE_2026_03_TEXT,
} from "./proces-verbaux-sainte-therese.fixture.js";
import {
  PV_DEUX_MONTAGNES_2026_04_TEXT,
} from "./proces-verbaux-deux-montagnes.fixture.js";
import {
  PV_MIRABEL_2026_04_TEXT,
} from "./proces-verbaux-mirabel.fixture.js";
import {
  PV_SAINT_EUSTACHE_2026_02_TEXT,
} from "./proces-verbaux-saint-eustache.fixture.js";
import {
  PV_MASCOUCHE_2026_04_TEXT,
} from "./proces-verbaux-mascouche.fixture.js";
import {
  PV_CHARLEMAGNE_2026_05_TEXT,
} from "./proces-verbaux-charlemagne.fixture.js";
import {
  PV_LASSOMPTION_2026_05_TEXT,
} from "./proces-verbaux-lassomption.fixture.js";
import {
  PV_LAVALTRIE_2026_05_TEXT,
} from "./proces-verbaux-lavaltrie.fixture.js";

/**
 * Complete registry of generic PV cities — the single source of truth for
 * city wiring in the pipeline (adapter-registry) and seed (pv-seed).
 *
 * To add a new city:
 *   1. Create `proces-verbaux-<slug>.fixture.ts` with the real PV text (pdftotext).
 *   2. Add a `*_PV_CONFIG` constant above.
 *   3. Append one entry here — adapter-registry and pv-seed are AUTO-wired.
 */
export const ALL_PV_CITIES: readonly PvCityEntry[] = [
  // ── Round-0: Saint-Damase (easy-first, WordPress, MRC des Maskoutains) ─────
  {
    config: SAINT_DAMASE_PV_CONFIG,
    pvText: PV_SAINT_DAMASE_2025_05_POSITIVE,
    sourceUrl:
      "https://www.st-damase.qc.ca/wp-content/uploads/2025/05/Proces-verbal-manuscrit-6-mai.pdf",
  },
  // ── Rive-Sud / MRC Roussillon ─────────────────────────────────────────────
  {
    config: SAINTE_CATHERINE_PV_CONFIG,
    pvText: PV_SAINTE_CATHERINE_2026_05_TEXT,
    sourceUrl:
      "https://www.ville.sainte-catherine.qc.ca/medias/documents/content/PvCm-20260512-vns-vp20260514.pdf",
  },
  {
    config: SAINT_CONSTANT_PV_CONFIG,
    pvText: PV_SAINT_CONSTANT_2026_05_TEXT,
    sourceUrl:
      "https://saint-constant.ca/uploads/attachments/Greffe/2026/2026-05-19/2026-05-19_PV_Seance_ordinaire_non_approuve_par_Conseil.pdf",
  },
  {
    config: LAPRAIRIE_PV_CONFIG,
    pvText: PV_LAPRAIRIE_2026_05_TEXT,
    sourceUrl:
      "https://laprairie.ca/storage/app/media/ville/democratie/seances-du-conseil/PV_2026/2026-05-19_pv_non_officiel.pdf",
  },
  {
    config: CHATEAUGUAY_PV_CONFIG,
    pvText: PV_CHATEAUGUAY_2026_02_TEXT,
    sourceUrl:
      "https://ville.chateauguay.qc.ca/wp-content/uploads/2026/03/PV_2026-02-23.pdf",
  },
  {
    config: DELSON_PV_CONFIG,
    pvText: PV_DELSON_2026_05_TEXT,
    sourceUrl:
      "https://ville.delson.qc.ca/wp-content/uploads/2026/05/2026-05-12-ordinaire-20h-2.pdf",
  },
  // ── Vaudreuil-Soulanges ───────────────────────────────────────────────────
  {
    config: VAUDREUIL_DORION_PV_CONFIG,
    pvText: PV_VAUDREUIL_DORION_2026_05_TEXT,
    sourceUrl:
      "https://www.ville.vaudreuil-dorion.qc.ca/uploads/sections/La_Ville/Mairie/Seances_publiques/PV_2026/20260519_pv.pdf",
  },
  // ── Beauharnois-Salaberry / Haut-St-Laurent ───────────────────────────────
  {
    config: SAINTE_MARTINE_PV_CONFIG,
    pvText: PV_SAINTE_MARTINE_2026_04_TEXT,
    sourceUrl:
      "https://sainte-martine.ca/wp-content/uploads/2026/05/conseil-avril-2026.pdf",
  },
  // ── Les Jardins-de-Napierville ────────────────────────────────────────────
  {
    config: SAINT_REMI_PV_CONFIG,
    pvText: PV_SAINT_REMI_2026_04_TEXT,
    sourceUrl:
      "https://www.saint-remi.ca/wp-content/uploads/2026/05/20260420_pv.pdf",
  },
  // ── Vallée-du-Richelieu ───────────────────────────────────────────────────
  {
    config: MCMASTERVILLE_PV_CONFIG,
    pvText: PV_MCMASTERVILLE_2025_11_TEXT,
    sourceUrl:
      "https://www.mcmasterville.ca/wp-content/uploads/2025/12/pv-17-novembre-2025.pdf",
  },
  {
    config: BELOEIL_PV_CONFIG,
    pvText: PV_BELOEIL_2026_02_TEXT,
    sourceUrl:
      "https://beloeil.ca/wp-content/uploads/2026/03/conseil_20260223_pv.pdf",
  },
  // ── Marguerite-D'Youville ─────────────────────────────────────────────────
  {
    config: SAINTE_JULIE_PV_CONFIG,
    pvText: PV_SAINTE_JULIE_2026_03_TEXT,
    sourceUrl:
      "https://saintejulie.ca/uploads/html_content/S%C3%A9ances%20publiques/2026-03-10_-_Proces-verbal.pdf",
  },
  // Laurentides ──────────────────────────────────────────────────────────────
  {
    config: SAINTE_THERESE_PV_CONFIG,
    pvText: PV_SAINTE_THERESE_2026_03_TEXT,
    sourceUrl:
      "https://www.sainte-therese.ca/storage/app/media/ville/democratie/seances-du-conseil/proces-verbaux/2026/26-03-02_ordinaire.pdf",
  },
  {
    config: DEUX_MONTAGNES_PV_CONFIG,
    pvText: PV_DEUX_MONTAGNES_2026_04_TEXT,
    sourceUrl:
      "https://www.ville.deux-montagnes.qc.ca/storage/app/media/ville-de-deux-montagnes/vie-democratique/seances-du-conseil/proces-verbaux/2026/2026-04-09-proces-verbal-ordinaire.pdf",
  },
  {
    config: MIRABEL_PV_CONFIG,
    pvText: PV_MIRABEL_2026_04_TEXT,
    sourceUrl:
      "https://mirabel.ca/uploads/2._Ville/2.3_Vie_democratique/2.3.5_Seances_du_conseil/2026/2026-04-13_Proces-verbal_FINAL.pdf",
  },
  {
    config: SAINT_EUSTACHE_PV_CONFIG,
    pvText: PV_SAINT_EUSTACHE_2026_02_TEXT,
    sourceUrl:
      "https://www.saint-eustache.ca/storage/app/media/ville/vie-democratique/seances-du-conseil/proces-verbaux/2026PV_internet.pdf",
  },
  // Lanaudière ───────────────────────────────────────────────────────────────
  {
    config: MASCOUCHE_PV_CONFIG,
    pvText: PV_MASCOUCHE_2026_04_TEXT,
    sourceUrl:
      "https://mascouche.ca/storage/app/media/ville/vie-democratique/seances-du-conseil/proces-verbaux/20260609proces-verbaux-seances-du-conseil.pdf",
  },
  {
    config: CHARLEMAGNE_PV_CONFIG,
    pvText: PV_CHARLEMAGNE_2026_05_TEXT,
    sourceUrl:
      "https://www.charlemagne.ca/storage/app/media/la-ville/S%C3%A9ances%20du%20conseil/Proc%C3%A8s-verbal%20officiel_12%20mai%202026.pdf",
  },
  {
    config: LASSOMPTION_PV_CONFIG,
    pvText: PV_LASSOMPTION_2026_05_TEXT,
    sourceUrl:
      "https://www.ville.lassomption.qc.ca/download.php?filename=pv20260512.pdf",
  },
  {
    config: LAVALTRIE_PV_CONFIG,
    pvText: PV_LAVALTRIE_2026_05_TEXT,
    sourceUrl:
      "https://www.ville.lavaltrie.qc.ca/storage/app/media/Proc%C3%A8s-verbaux/2026/2026-05-04_PV_ord.pdf",
  },
];
