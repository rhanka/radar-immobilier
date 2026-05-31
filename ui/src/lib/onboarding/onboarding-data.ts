import type {
  RecommendationKind,
  SourceEvaluation,
  VisionAlignment,
} from "../source-review/source-evaluation-data";
import { sourceEvaluations } from "../source-review/source-evaluation-data";

export { sourceEvaluations };

export const RETRO_WINDOW_MONTHS_DEFAULT = 24;

// --- Municipalities ---

export interface Municipality {
  id: string;
  name: string;
}

export const QUEBEC_MUNICIPALITIES: Municipality[] = [
  { id: "salaberry-de-valleyfield", name: "Salaberry-de-Valleyfield" },
  { id: "vaudreuil-dorion", name: "Vaudreuil-Dorion" },
  { id: "beauharnois", name: "Beauharnois" },
  { id: "chateauguay", name: "Chateauguay" },
  { id: "saint-constant", name: "Saint-Constant" },
  { id: "mercier", name: "Mercier" },
  { id: "saint-jean-sur-richelieu", name: "Saint-Jean-sur-Richelieu" },
  { id: "sorel-tracy", name: "Sorel-Tracy" },
];

export const DEFAULT_MUNICIPALITY_ID = "salaberry-de-valleyfield";

// --- Label maps ---

export const RECOMMENDATION_LABELS_FR: Record<RecommendationKind, string> = {
  "build-now": "Prioritaire (prete a activer)",
  "qualify-access-now": "A qualifier (acces a valider)",
  "build-later": "Plus tard",
  "manual-check": "Verification manuelle",
  "drop-phase-1": "Hors perimetre",
};

export const VISION_ALIGNMENT_LABELS_FR: Record<VisionAlignment, string> = {
  "regulatory-signal": "Signal reglementaire",
  "parcel-anchor": "Ancrage foncier",
  "constraint-filter": "Filtre de contrainte",
  "market-validation": "Validation marche",
  "strategic-context": "Contexte strategique",
  "history-learning": "Apprentissage historique",
  "false-positive-control": "Reduction faux positifs",
};

// --- Per-source benefit descriptions (plain French, one line) ---

export const SOURCE_BENEFIT_FR: Record<string, string> = {
  "avis-publics-valleyfield":
    "Detecte les avis de derogation, PPCMOI et consultations publiques avant qu'ils ne soient connus du marche.",
  "reglements-urbanisme-valleyfield":
    "Relie les numeros de reglement aux impacts reels sur la densification et le zonage.",
  "ppcmoi-valleyfield":
    "Capte les projets negocies hors-zonage ordinaire, tres avant la decision finale.",
  "seances-conseil-valleyfield":
    "Reconstruit le cycle de vie des dossiers a partir des ordres du jour et des proces-verbaux.",
  "videos-youtube-conseil-valleyfield":
    "Acces aux discussions a la source avant la publication des proces-verbaux officiels.",
  "avis-reglements-mrcbhs":
    "Signaux reglementaires regionaux qui peuvent preceder les changements a l'echelle municipale.",
  "schema-amenagement-mrcbhs":
    "Contexte de planification a long terme pour qualifier la pression de densification.",
  "seances-conseil-maires-mrcbhs":
    "Orientations de gouvernance regionale utiles pour contextualiser les dossiers locaux.",
  "donnees-quebec-catalog":
    "Plomberie de decouverte de jeux de donnees publics (MAMH, CPTAQ, BDZI, etc.).",
  "roles-evaluation-fonciere-mamh":
    "Ancre chaque signal sur une parcelle reelle avec valeur, usage et superficie.",
  "adresses-quebec-igo-geocoder":
    "Normalise les adresses textuelles en coordonnees geospatiales pour le scoring.",
  "cptaq-zone-agricole":
    "Elimine les faux positifs sur des terrains bloques par la zone agricole protegee.",
  "cptaq-decisions":
    "Transforme un simple blocage en opportunite si une decision d'autorisation existe.",
  "bdzi-flood-zones":
    "Reduit les faux positifs sur les terrains en zone inondable.",
  "grhq-hydrography":
    "Bandes riveraines et proximite hydrique pour les obligations de recul reglementaire.",
  "zonage-municipal-open-data":
    "Couche de zonage publiee par les villes qui la rendent disponible en acces libre.",
  "zonage-plans-grilles-valleyfield":
    "Grilles et plans de zonage officiels pour valider le potentiel de densification.",
  "cadastre-infolot":
    "Geometrie des parcelles et identification cadastrale pour l'assemblage foncier.",
  "registre-foncier-qc":
    "Due diligence proprietaire et charges legales sur les parcelles cibles.",
  "jlr":
    "Transactions, historique de propriete et donnees de marche pour la validation.",
  "centris-mls":
    "Inscriptions et absorption du marche si un acces partenarial est obtenu.",
  "transactions-immobilieres":
    "Contexte de marche historique pour relier signaux reglementaires et repricing.",
  "permis-construction-valleyfield":
    "Valide si les signaux anterieurs ont debouche sur des permis reels.",
  "construction-permits-open-data":
    "Permis de construction publics pour les villes qui les exposent en acces libre.",
  "statcan-census-profile-2021":
    "Profil demografique et socio-economique de la municipalite pour le narratif client.",
  "statcan-wds-socioeconomic-tables":
    "Indicateurs statistiques approfondis apres validation des metriques prioritaires.",
  "statcan-core-public-infrastructure-assets":
    "Contexte macroeconomique sur les actifs d'infrastructure publique.",
  "infc-hicc-projects":
    "Investissements publics federaux pouvant catalyser la densification locale.",
  "mtmd-travaux-routiers":
    "Travaux routiers comme catalyseurs de timing pour les secteurs adjacents.",
  "mtmd-reseau-routier-rtss":
    "Hierarchie routiere pour le contexte d'accessibilite et de scoring de proximite.",
  "exo-gtfs-transit-service":
    "Accessibilite en transport en commun pour la demande residentiellement dense.",
  "salaberry-info-travaux-projets":
    "Projets et travaux locaux pour le narratif 'pourquoi ce secteur, pourquoi maintenant'.",
  "artm-grands-projets":
    "Grands projets de transport a l'echelle regionale (faible pertinence Valleyfield).",
  "orthophotos-imagery":
    "Validation visuelle des friches, terrains vacants et sites sous-utilises.",
};

// --- groupByRecommendation ---

const RECOMMENDATION_ORDER: RecommendationKind[] = [
  "build-now",
  "qualify-access-now",
  "build-later",
  "manual-check",
  "drop-phase-1",
];

export interface RecommendationGroup {
  recommendation: RecommendationKind;
  label: string;
  sources: SourceEvaluation[];
}

export function groupByRecommendation(
  sources: SourceEvaluation[] = sourceEvaluations,
): RecommendationGroup[] {
  const map = new Map<RecommendationKind, SourceEvaluation[]>();

  for (const source of sources) {
    const existing = map.get(source.recommendation);
    if (existing) {
      existing.push(source);
    } else {
      map.set(source.recommendation, [source]);
    }
  }

  // Build ordered list: known order first, then any unknown kinds
  const ordered: RecommendationKind[] = [
    ...RECOMMENDATION_ORDER.filter((k) => map.has(k)),
    ...[...map.keys()].filter((k) => !RECOMMENDATION_ORDER.includes(k)),
  ];

  return ordered.map((recommendation) => ({
    recommendation,
    label: RECOMMENDATION_LABELS_FR[recommendation] ?? recommendation,
    sources: map.get(recommendation) ?? [],
  }));
}

// --- defaultSelection ---

export function defaultSelection(
  sources: SourceEvaluation[] = sourceEvaluations,
): string[] {
  return sources
    .filter((s) => s.recommendation === "build-now")
    .map((s) => s.id);
}

// --- summarize ---

export interface OnboardingSummary {
  total: number;
  byRecommendation: Record<string, number>;
}

export function summarize(
  selectedIds: string[],
  sources: SourceEvaluation[] = sourceEvaluations,
): OnboardingSummary {
  const idSet = new Set(selectedIds);
  const selected = sources.filter((s) => idSet.has(s.id));

  const byRecommendation: Record<string, number> = {};
  for (const s of selected) {
    const key = s.recommendation;
    byRecommendation[key] = (byRecommendation[key] ?? 0) + 1;
  }

  return { total: selected.length, byRecommendation };
}
