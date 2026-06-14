/**
 * Types communs du provider carte-steve CS-L6.
 *
 * mode: "carte-steve" — données réelles de la plateforme de Steve (Netlify),
 * distinctes des données MRNF scrappées. Ces données NE polluent JAMAIS le
 * pipeline réel (SPEC_EVOL_SOCLE_STATES_SCORING.md §2.7).
 *
 * Champs extraits exclusivement du JSON Netlify de Steve :
 * NO_LOT, zone, superficie_m2_calculee, categorie, cubf, utilisation,
 * annee_construction, nb_logements_role, nb_etages, val_totale, val_terrain,
 * val_batiment, facade_m, profondeur_m, adresse, is_rue, tod, multifamilial_4plus.
 * Aucun champ inventé ; aucun nom de propriétaire (données cadastrales publiques).
 */

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

/** Détail du score canonique [0-10] adapté au contexte simulation. */
export interface SimulationScoreDetail {
  /** Score de base 0-5 (densiteLogHa → palier). */
  scoreBase: number;
  /** Bonus kind résidentiel/mixte (+1.0 si H ou MIXTE). */
  bonusKind: number;
  /** Bonus TOD (+1.0 si inTod). */
  bonusTod: number;
  /** Malus usage non-constructible (-1.0 si BO/TE — null dans fixtures Steve). */
  malusUsage: number;
  /** Bonus zone reconvertible (+0.5 si C/U/I). */
  bonusReconvertible: number;
  /** Lot filtré (surface trop petite ou usage exclu). */
  filteredOut: boolean;
  /** Raison du filtrage si filteredOut. */
  filteredReason?: string;
  /** Kind de zone dérivé du préfixe Steve. */
  zoneKind: SimulationZoneKind;
  /** Lot dans un périmètre TOD. */
  inTod: boolean;
  /** Lot est une emprise de rue (exclu). */
  isRue: boolean;
}

/** Un lot enrichi depuis la carte Steve (propriétés Steve + score de potentiel canonique). */
export interface SimulationLotProperties {
  /** NO_LOT cadastral — identifiant public. Espaces normalisés. */
  noLot: string;
  citySlug: string;
  mode: "carte-steve";
  /**
   * Tag de provenance — toujours "steve-import" pour les données de la carte Steve.
   * Permet de distinguer les données importées de Steve des données scrapées/graphifiées.
   */
  provenance: "steve-import";
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
  /**
   * Flag priorité = multifamilial 4+ ∩ TOD (calculé par Steve, préservé tel quel).
   * Source: priorite dans le JSON Steve.
   * Lots prioritaires sont affichés en orange sur la carte.
   */
  priorite: boolean;
  /**
   * Score de potentiel par lot [0, 10] — scorer canonique (#165).
   * Échelle DISTINCTE du 0-5 T2 et du 0-100 legacy.
   * 0 si is_rue=true ou si toutes les composantes sont nulles.
   */
  potentialScore: number | null;
  /** Composantes du score canonique. null si non calculable. */
  scoreDetail: SimulationScoreDetail | null;
}

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

/** Résumé de la fixture carte-steve par ville. */
export interface SimulationCityFixture {
  citySlug: string;
  mode: "carte-steve";
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
