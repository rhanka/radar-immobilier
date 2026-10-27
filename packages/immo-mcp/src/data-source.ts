import {
  MOCK_DOCUMENT_BODIES,
  MOCK_DOCUMENTS,
  MOCK_LOTS,
  MOCK_OPPORTUNITIES,
  MOCK_SIGNALS,
  type MockDocument,
  type MockLot,
  type MockOpportunity,
  type MockSignal,
} from "./mocks.js";
import { citySlug } from "./raw-data.js";
import { decodeSignalReadError, RadarSignalReadError } from "./signal-read-error.js";
import { parseSignalSearchResponse, SIGNAL_SEARCH_PATH } from "./signal-search-response.js";

export interface SearchLotsArgs {
  city: string;
  zone?: string | undefined;
  no_lot?: string | undefined;
  minArea?: number | undefined;
  limit: number;
}

export interface GetLotCardArgs {
  city: string;
  no_lot: string;
}

export interface SearchSignalsArgs {
  city: string;
  etape?: string | undefined;
  query?: string | undefined;
  /**
   * Authorized reveal includes archived signals; omission preserves hiding.
   */
  showDiscarded?: boolean | undefined;
  /**
   * Reserved API context; the deployed tool schema does not expose it.
   */
  workspaceId?: string | undefined;
  limit: number;
}

export interface GetOpportunityDossierArgs {
  city: string;
  opportunityId: string;
}

export interface ListDocumentsArgs {
  city?: string | undefined;
  limit: number;
}

export interface ReadDocumentExcerptArgs {
  documentId: string;
  offset: number;
  maxChars: number;
}

export interface LotCard extends MockLot {
  related_signals: string[];
}

export interface OpportunityDossier extends MockOpportunity {
  lots: MockLot[];
  signals: MockSignal[];
}

export interface DocumentExcerpt {
  documentId: string;
  title: string;
  offset: number;
  length: number;
  total_length: number;
  /** Excerpt text AFTER redaction has been applied by the tool layer. */
  excerpt: string;
  truncated: boolean;
}

/**
 * Per-call caller identity, threaded from the tool layer's auth CONTEXT (never
 * from LLM/tool arguments). Lets a source act under the CURRENT user's identity
 * — e.g. forward their bearer token to the radar API (D4, per-user auth).
 */
export interface DataSourceCallContext {
  /** Exchanged delegated token, when the tool resolved one. */
  accessToken?: string | undefined;
}

/**
 * The contract every backing source must satisfy. v0 ships `MockDataSource`;
 * phase 2 swaps in `HttpDataSource` (radar API) WITHOUT touching the tool
 * signatures or the auth layer.
 */
export interface ImmoDataSource {
  readonly mode: "mock" | "http";
  searchLots(args: SearchLotsArgs): Promise<MockLot[]>;
  getLotCard(args: GetLotCardArgs): Promise<LotCard | null>;
  searchSignals(args: SearchSignalsArgs, ctx?: DataSourceCallContext): Promise<MockSignal[]>;
  getOpportunityDossier(args: GetOpportunityDossierArgs): Promise<OpportunityDossier | null>;
  listDocuments(args: ListDocumentsArgs): Promise<MockDocument[]>;
  /** Returns the RAW document body (redaction is applied by the tool layer). */
  readDocumentBody(documentId: string): Promise<{ title: string; text: string } | null>;
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

/** Default v0 source: deterministic in-memory fixtures, zero network, zero PII. */
export class MockDataSource implements ImmoDataSource {
  readonly mode = "mock" as const;

  async searchLots(args: SearchLotsArgs): Promise<MockLot[]> {
    const city = norm(args.city);
    return MOCK_LOTS.filter((lot) => norm(lot.city) === city)
      .filter((lot) => (args.zone ? norm(lot.zone) === norm(args.zone) : true))
      .filter((lot) => (args.no_lot ? lot.no_lot === args.no_lot : true))
      .filter((lot) => (args.minArea ? lot.area_m2 >= args.minArea : true))
      .slice(0, args.limit);
  }

  async getLotCard(args: GetLotCardArgs): Promise<LotCard | null> {
    const city = norm(args.city);
    const lot = MOCK_LOTS.find((l) => norm(l.city) === city && l.no_lot === args.no_lot);
    if (!lot) return null;
    const related = MOCK_SIGNALS.filter((s) => s.no_lot === lot.no_lot).map((s) => s.id);
    return { ...lot, related_signals: related };
  }

  // Mock fixtures carry no discard dimension: showDiscarded is accepted and
  // ignored here; hiding and reveal are enforced server-side in http mode.
  async searchSignals(args: SearchSignalsArgs): Promise<MockSignal[]> {
    const city = norm(args.city);
    const q = args.query ? norm(args.query) : null;
    return MOCK_SIGNALS.filter((s) => norm(s.city) === city)
      .filter((s) => (args.etape ? norm(s.etape) === norm(args.etape) : true))
      .filter((s) =>
        q
          ? norm(`${s.summary} ${s.type} ${s.reglement_number} ${s.zone_ref}`).includes(q)
          : true,
      )
      .slice(0, args.limit);
  }

  async getOpportunityDossier(
    args: GetOpportunityDossierArgs,
  ): Promise<OpportunityDossier | null> {
    const opp = MOCK_OPPORTUNITIES.find(
      (o) => o.id === args.opportunityId && norm(o.city) === norm(args.city),
    );
    if (!opp) return null;
    const lots = MOCK_LOTS.filter((l) => opp.lot_refs.includes(l.no_lot));
    const signals = MOCK_SIGNALS.filter((s) => opp.signal_refs.includes(s.id));
    return { ...opp, lots, signals };
  }

  async listDocuments(args: ListDocumentsArgs): Promise<MockDocument[]> {
    const city = args.city ? norm(args.city) : null;
    return MOCK_DOCUMENTS.filter((d) => (city ? norm(d.city) === city : true)).slice(
      0,
      args.limit,
    );
  }

  async readDocumentBody(documentId: string): Promise<{ title: string; text: string } | null> {
    const doc = MOCK_DOCUMENTS.find((d) => d.id === documentId);
    const body = MOCK_DOCUMENT_BODIES.find((b) => b.id === documentId);
    if (!doc || !body) return null;
    return { title: doc.title, text: body.text };
  }
}


export interface HttpDataSourceOptions {
  /** In-cluster/internal radar API base, e.g. http://radar-api:3000. */
  baseUrl: string;
  /** Injectable for tests (default: global fetch). */
  fetchImpl?: typeof fetch;
}

/**
 * Real radar API behind `RADAR_API_BASE_URL` (in-cluster: http://radar-api:3000).
 *
 * `searchSignals` reads the protected scoped facade. The API resolves current
 * membership, applies visibility and normalizes cards before filtering/limit.
 *
 * PER-USER AUTH (D4): that route is SESSION-PROTECTED (NOT a public prefix). We
 * forward the exchanged delegated bearer token (ctx.accessToken, verified upstream
 * by the MCP resource server) as `Authorization: Bearer`, so the radar API sees
 * the real user identity — never a shared machine credential. The radar API
 * ACCEPTS this user bearer (api `protect`: verified against the IdP JWKS,
 * audience-bounded, approved-account) → per-user end-to-end. A 401/403 upstream
 * is surfaced as a typed authentication or authorization error.
 *
 * The other v0 domain tools (lots, opportunities, documents) are NOT wired yet:
 * they throw `not_wired_yet`. Real lots/zones/PV are already served by the
 * raw-data tools; wiring the remaining domain tools is tracked separately.
 */
export class HttpDataSource implements ImmoDataSource {
  readonly mode = "http" as const;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: HttpDataSourceOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private notWired(endpoint: string): never {
    throw new Error(
      `not_wired_yet:http_data_source ${endpoint} base=${this.baseUrl} ` +
        "(only search_signals is wired to the real radar API in this seam)",
    );
  }

  async searchLots(_args: SearchLotsArgs): Promise<MockLot[]> {
    return this.notWired("GET /api/geo/:city/lots (use get_lots_geojson)");
  }
  async getLotCard(_args: GetLotCardArgs): Promise<LotCard | null> {
    return this.notWired("GET /api/geo/:city/lots?no_lot=");
  }

  /** One request under the exchanged human credential; no retry or fallback. */
  async searchSignals(
    args: SearchSignalsArgs,
    ctx: DataSourceCallContext = {},
  ): Promise<MockSignal[]> {
    const slug = citySlug(args.city);
    const params = new URLSearchParams({ city: slug, limit: String(args.limit) });
    if (args.etape !== undefined) params.set("etape", args.etape);
    if (args.query !== undefined) params.set("query", args.query);
    if (args.showDiscarded !== undefined) params.set("showDiscarded", args.showDiscarded ? "1" : "0");
    if (args.workspaceId !== undefined) params.set("workspaceId", args.workspaceId);
    const url = `${this.baseUrl}${SIGNAL_SEARCH_PATH}?${params}`;
    // Forward the exchanged delegated token so the api applies its normal per-user auth.
    const headers: Record<string, string> = { accept: "application/json" };
    if (ctx.accessToken) headers.authorization = `Bearer ${ctx.accessToken}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, { method: "GET", headers, redirect: "error" });
    } catch {
      throw new RadarSignalReadError("radar_api_unreachable");
    }
    if (res.status !== 200) throw await decodeSignalReadError(res);
    let body: unknown;
    try { body = await res.json(); } catch { throw new RadarSignalReadError("radar_api_bad_payload", 200); }
    return parseSignalSearchResponse(body, { city: slug, limit: args.limit, workspaceId: args.workspaceId });
  }

  async getOpportunityDossier(
    _args: GetOpportunityDossierArgs,
  ): Promise<OpportunityDossier | null> {
    return this.notWired("GET /api/opportunites + /api/signals/:city/detail");
  }
  async listDocuments(_args: ListDocumentsArgs): Promise<MockDocument[]> {
    return this.notWired("GET /api/documents/raw (list)");
  }
  async readDocumentBody(_documentId: string): Promise<{ title: string; text: string } | null> {
    return this.notWired("GET /api/documents/raw (bounded excerpt)");
  }
}

/**
 * Factory: `RADAR_API_BASE_URL` set → `HttpDataSource` (real signals from the
 * radar API); unset → `MockDataSource` (deterministic fixtures). Mirrors
 * `createRawDataSource` so BOTH the domain and raw seams flip on the SAME env
 * var — no more `IMMO_MCP_DATA_MODE=http` gate that left `searchSignals` a
 * `not_wired_yet` stub in prod (root cause of the MCP-returns-0-signals bug).
 */
export function createDataSource(env: NodeJS.ProcessEnv): ImmoDataSource {
  const base = env.RADAR_API_BASE_URL;
  if (base) return new HttpDataSource({ baseUrl: base });
  return new MockDataSource();
}
