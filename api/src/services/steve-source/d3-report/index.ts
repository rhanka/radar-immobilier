/**
 * d3-report entry point: report-only Triage matching, no persistence.
 */

export {
  REAL_GRAPH_ADAPTER_VERSION,
  extractGraphNodeTokens,
} from "./graph-adapter.js";
export type { GraphAdapterTokens } from "./graph-adapter.js";
export {
  D3_RULE_VERSION,
  resolveTriageRow,
  tripletKey,
} from "./resolve.js";
export type {
  D3ResolvedTriplet,
  D3RowResolution,
  D3RowStatus,
} from "./resolve.js";
export {
  GRAPH_NODE_DESIGNATION_EVENT,
  GRAPH_NODE_SIGNAL,
  buildGraphSet,
  canonicalGraphSetJson,
  findGraph,
  isGraphNodeType,
  normalizeGraphReglementProp,
  normalizeReglementKey,
  splitReglementTokens,
} from "./graph-set.js";
export type {
  IdentifiedGraphSet,
  ReglementTokens,
  SyntheticGraph,
  SyntheticGraphNode,
} from "./graph-set.js";
export {
  normalizeMunicipalityName,
  resolveMunicipality,
} from "./municipality.js";
export type {
  MunicipalityRef,
  MunicipalityResolution,
} from "./municipality.js";
export { buildD3Report } from "./report.js";
export type { D3Report, D3StatusCounts } from "./report.js";
export {
  TRIAGE_HEADER_CITY,
  TRIAGE_HEADER_CLASSEMENT,
  TRIAGE_HEADER_MRC,
  TRIAGE_HEADER_NUMBER,
  TRIAGE_HEADER_REGLEMENT,
  TRIAGE_SHEET_NAME,
  readTriageRows,
} from "./triage-rows.js";
export type {
  TriageCell,
  TriageLocator,
  TriageRow,
} from "./triage-rows.js";
