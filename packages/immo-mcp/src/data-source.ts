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
 * The contract every backing source must satisfy. v0 ships `MockDataSource`;
 * phase 2 swaps in `HttpDataSource` (radar API) WITHOUT touching the tool
 * signatures or the auth layer.
 */
export interface ImmoDataSource {
  readonly mode: "mock" | "http";
  searchLots(args: SearchLotsArgs): Promise<MockLot[]>;
  getLotCard(args: GetLotCardArgs): Promise<LotCard | null>;
  searchSignals(args: SearchSignalsArgs): Promise<MockSignal[]>;
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

/**
 * Phase-2 seam: real radar API behind `RADAR_API_BASE_URL`.
 *
 * NOT exercised in v0 (selected only when IMMO_MCP_DATA_MODE=http). It maps
 * each tool to the documented radar endpoints (cf. cadrage §A.4). The shapes
 * are normalised back to the same domain types so the tool layer is unchanged.
 * Left as explicit `not_wired_yet` until the API + PII classification land,
 * to avoid emitting unredacted real data prematurely.
 */
export class HttpDataSource implements ImmoDataSource {
  readonly mode = "http" as const;
  constructor(private readonly baseUrl: string) {}

  private notWired(endpoint: string): never {
    throw new Error(
      `not_wired_yet:http_data_source ${endpoint} base=${this.baseUrl} ` +
        "(phase 2: wire radar API + PII classification before enabling DATA_MODE=http)",
    );
  }

  async searchLots(_args: SearchLotsArgs): Promise<MockLot[]> {
    return this.notWired("GET /api/geo/:city/lots");
  }
  async getLotCard(_args: GetLotCardArgs): Promise<LotCard | null> {
    return this.notWired("GET /api/geo/:city/lots?no_lot=");
  }
  async searchSignals(_args: SearchSignalsArgs): Promise<MockSignal[]> {
    return this.notWired("GET /api/graph-signals/:city");
  }
  async getOpportunityDossier(
    _args: GetOpportunityDossierArgs,
  ): Promise<OpportunityDossier | null> {
    return this.notWired("GET /api/opportunites + /api/signals/:city/detail");
  }
  async listDocuments(_args: ListDocumentsArgs): Promise<MockDocument[]> {
    return this.notWired("GET /api/documents/raw");
  }
  async readDocumentBody(_documentId: string): Promise<{ title: string; text: string } | null> {
    return this.notWired("GET /api/documents/raw (bounded excerpt)");
  }
}

/**
 * Factory selecting the source from env. Mock is the safe default; `http`
 * requires an explicit opt-in AND a base URL.
 */
export function createDataSource(env: NodeJS.ProcessEnv): ImmoDataSource {
  if (env.IMMO_MCP_DATA_MODE === "http") {
    const base = env.RADAR_API_BASE_URL;
    if (!base) {
      throw new Error("config_error: IMMO_MCP_DATA_MODE=http requires RADAR_API_BASE_URL");
    }
    return new HttpDataSource(base);
  }
  return new MockDataSource();
}
