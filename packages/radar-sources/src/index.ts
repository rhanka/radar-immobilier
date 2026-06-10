export * from "./SourceAdapter.js";
export * from "./RawDocument.js";
export * from "./prioritySources.js";
export * from "./sources/avis-publics-parser.js";
export * from "./sources/role-evaluation-parser.js";
export * from "./sources/adresses-quebec-parser.js";
export * from "./sources/reglements-urbanisme-parser.js";
export * from "./sources/avis-publics-valleyfield.js";
export * from "./sources/avis-publics-beauharnois.js";
export * from "./sources/avis-publics-generic.js";
export * from "./sources/role-evaluation-mamh.js";
export * from "./sources/adresses-quebec.js";
export * from "./sources/reglements-urbanisme-valleyfield.js";
export { AVIS_PUBLICS_FIXTURE_HTML } from "./sources/avis-publics-valleyfield.fixture.js";
export { AVIS_PUBLICS_BEAUHARNOIS_FIXTURE_HTML } from "./sources/avis-publics-beauharnois.fixture.js";
export {
  ROLE_EVALUATION_MAMH_VALLEYFIELD_XML,
  ROLE_EVALUATION_MAMH_BEAUHARNOIS_XML,
} from "./sources/role-evaluation-mamh.fixture.js";
export {
  ADRESSES_QUEBEC_VALLEYFIELD_JSON,
  ADRESSES_QUEBEC_BEAUHARNOIS_JSON,
} from "./sources/adresses-quebec.fixture.js";
export {
  REGLEMENT_450_02_TEXT,
  REGLEMENT_150_51_TEXT,
} from "./sources/reglements-urbanisme-valleyfield.fixture.js";
export { QC_MUNICIPALITIES, prioritizedCities } from "./municipalities.js";
export * from "./geo/geo-source-inventory.js";
export * from "./geo/geo-source-inventory.data.js";
export * from "./geo/geo-vertical-priority.js";
export * from "./sources/proces-verbaux-parser.js";
export * from "./sources/proces-verbaux-generic.js";
export {
  PV_SAINT_DAMASE_2025_05_POSITIVE,
  PV_SAINT_DAMASE_2026_03_NEGATIVE,
  PV_SAINT_DAMASE_INDEX_HTML,
} from "./sources/proces-verbaux-saint-damase.fixture.js";
export {
  PV_SAINT_CONSTANT_2026_05_TEXT,
  PV_SAINT_CONSTANT_INDEX_HTML,
} from "./sources/proces-verbaux-saint-constant.fixture.js";
export {
  PV_SAINTE_CATHERINE_2026_05_TEXT,
  PV_SAINTE_CATHERINE_INDEX_HTML,
} from "./sources/proces-verbaux-sainte-catherine.fixture.js";
export {
  PV_LAPRAIRIE_INDEX_HTML,
  PV_LAPRAIRIE_2026_05_TEXT,
} from "./sources/proces-verbaux-laprairie.fixture.js";
export {
  PV_CHATEAUGUAY_INDEX_HTML,
  PV_CHATEAUGUAY_2026_02_TEXT,
} from "./sources/proces-verbaux-chateauguay.fixture.js";
export {
  PV_DELSON_INDEX_HTML,
  PV_DELSON_2026_05_TEXT,
} from "./sources/proces-verbaux-delson.fixture.js";
export {
  PV_VAUDREUIL_DORION_INDEX_HTML,
  PV_VAUDREUIL_DORION_2026_05_TEXT,
} from "./sources/proces-verbaux-vaudreuil-dorion.fixture.js";
export * from "./sources/voxtral-transcriber.js";
export * from "./sources/youtube-seances.js";
export {
  SEANCE_VTT_FIXTURE,
  EXPECTED_PLAIN_TRANSCRIPT,
  YOUTUBE_SEARCH_RESPONSE_FIXTURE,
  YOUTUBE_SEARCH_EMPTY_RESPONSE_FIXTURE,
} from "./sources/youtube-seances.fixture.js";
