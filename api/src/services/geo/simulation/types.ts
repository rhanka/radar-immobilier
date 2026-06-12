/**
 * Types communs du mode simulation CS-L6.
 *
 * mode: "simulation" — ces données NE polluent JAMAIS le réel.
 * Toutes les entités portent ce discriminant (SPEC_EVOL_SOCLE_STATES_SCORING.md §2.7).
 *
 * Champs extraits exclusivement du JSON Netlify de Steve :
 * NO_LOT, zone, superficie_m2_calculee, categorie, cubf, utilisation,
 * annee_construction, nb_logements_role, nb_etages, val_totale, val_terrain,
 * val_batiment, facade_m, profondeur_m, adresse, is_rue, tod, multifamilial_4plus.
 * Aucun champ inventé ; aucun nom de propriétaire (données cadastrales publiques).
 */

/** Un lot enrichi en mode simulation (propriétés Steve + score de potentiel). */
export interface SimulationLotProperties {
  /** NO_LOT cadastral — identifiant public. Espaces normalisés. */
  noLot: string;
  citySlug: string;
  mode: "simulation";
  /** Code de zone (ex. "H-104"). Peut être vide ("") si inconnu. */
  zone: string;
  /** Superficie calculée géométriquement (m²). Source: superficie_m2_calculee. */
  superficieM2: number;
  /** Catégorie Steve (ex. "Résidentiel"). Source: categorie. */
  categorie: string;
  /** Code CUBF (ex. "1000"). Source: cubf. */
  cubf: string;
  /** Utilisation textuelle (ex. "Résidentiel 1 log."). Source: utilisation. */
  utilisation: string;
  /** Année de construction (ex. "1997"). Source: annee_construction. */
  anneeConstruction: string;
  /** Nombre de logements au rôle. Source: nb_logements_role. */
  nbLogementsRole: number;
  /** Nombre d'étages. Source: nb_etages. */
  nbEtages: string;
  /** Valeur totale au rôle 2022 ($). Source: val_totale. */
  valTotale: number;
  /** Valeur terrain ($). Source: val_terrain. */
  valTerrain: number;
  /** Valeur bâtiment ($). Source: val_batiment. */
  valBatiment: number;
  /** Façade estimée (m). Source: facade_m. */
  facadeM: number;
  /** Profondeur estimée (m). Source: profondeur_m. */
  profondeurM: number;
  /** Adresse civique. Source: adresse. */
  adresse: string;
  /** Flag emprise de rue (exclus de l'affichage). Source: is_rue. */
  isRue: boolean;
  /** Flag dans périmètre TOD (calculé par Steve). Source: tod. */
  tod: boolean;
  /** Flag multifamilial 4+ (calculé par Steve). Source: multifamilial_4plus. */
  multifamilial4plus: boolean;
  /** Score de potentiel par lot [0, 1]. Calculé par potentialScore(). */
  potentialScore: number | null;
  /** Composantes du score. null si non calculable (zone manquante). */
  scoreDetail: SimulationScoreDetail | null;
}

/** Détail des composantes du score de potentiel par lot. */
export interface SimulationScoreDetail {
  /** Zone a une densiteLogHa > 0 (zonage multi-logements). */
  hasDensiteLogHa: boolean;
  /** densiteLogHa de la ZoneVersion (logements/ha). */
  densiteLogHa: number;
  /** Lot dans un périmètre TOD. */
  inTod: boolean;
  /** Superficie suffisante (≥ 300 m²). */
  superficieSuffisante: boolean;
  /** Type d'usage de la zone (dérivé du préfixe de code). */
  zoneKind: SimulationZoneKind;
  /** Vrai si le lot n'est pas une rue et a une géométrie. */
  eligible: boolean;
}

/** Kind de zone dérivé du préfixe du code de zone Steve. */
export type SimulationZoneKind =
  | "habitation"     // H- → résidentiel (densification possible)
  | "mixte"          // M-, MS-, MxtV- → mixte (potentiel moyen)
  | "commercial"     // C- → commercial
  | "industriel"     // I-, ID- → industriel
  | "public"         // P-, CGS- → public/institutionnel
  | "conservation"   // N/A → conservation
  | "autre"          // "" ou inconnu
  ;

/** Une zone en mode simulation (propriétés Steve). */
export interface SimulationZone {
  /** Code de zone (ex. "H-104"). Source: zone dans les features de zones. */
  codeAffiche: string;
  /** Nom de la zone (ex. "Résidentielle"). Source: nom. */
  nom: string;
  /** Kind dérivé du préfixe. */
  kind: SimulationZoneKind;
  /** Densité de logements estimée (log/ha). Dérivée du kind et du code. */
  densiteLogHa: number;
  /** Usages permis (dérivés du kind). */
  usages: string[];
  /** Géométrie de la zone. */
  geom: GeoJsonGeometry | null;
}

/** GeoJSON geometry minimal. */
export interface GeoJsonGeometry {
  type: string;
  coordinates: unknown;
}

/** Résumé de la fixture simulation par ville. */
export interface SimulationCityFixture {
  citySlug: string;
  mode: "simulation";
  meta: Record<string, unknown>;
  /** Nombre de lots dans la fixture (échantillon si >200). */
  nLots: number;
  /** Nombre de zones disponibles. */
  nZones: number;
  /** Nombre de périmètres TOD. */
  nTod: number;
  /** Nombre de lots avec zone résolue. */
  nLotsWithZone: number;
  /** Nombre de lots avec potentialScore non-nul. */
  nLotsScored: number;
}
