/**
 * Valleyfield opportunity dossiers — 3 real dossiers built from committed
 * investigation findings (Lots 2–5 of feat/vertical-slice-valleyfield).
 *
 * ANTI-INVENTION: every datum below is sourced from one of:
 *   - role-cadastre-valleyfield.md     (rôle XML 70052 + cadastre allégé)
 *   - signal-marche-contexte-valleyfield.md (avis PDF, grilles, MRC, StatCan)
 *   - contraintes-geo-valleyfield.md   (BDZI/GRHQ/CPTAQ per zone)
 *   - youtube-conseil-valleyfield.md   (timeline + transcript blocker)
 *
 * Where the investigation found nothing, the field is "non-disponible" or
 * the verification is "non-disponible". Nothing is invented.
 */

import {
  OpportunityDossier,
  type OpportunityDossierT,
  weightedScore,
} from "@radar/domain";

// ─────────────────────────────────────────────────────────────────────────────
// Dossier 1 — H-609-4 / règl. 150-49
// ─────────────────────────────────────────────────────────────────────────────

const scores1 = {
  /**
   * 4 / 5 — règl. 150-49 creates zone H-609-4 ex-novo with density up to
   * 50 log/ha (≥30 % boisé conservé + PIIA règl.153). Strong regulatory lift
   * but conditional on conservation ratio and PIIA procedure.
   * Source: règl. 150-49 art.12.7.1 ; avis consultation PDF 2026-02-25.
   */
  potentiel: 4,

  /**
   * 3 / 5 — No BDZI flood zone in bbox (0 features REST, high confidence).
   * GRHQ: no large water body identified in H-609-4 sub-bbox. CPTAQ: A-939
   * (LPTA) adjacent to H-609 on Feuillet-1 — intersection with H-609-4
   * specifically is an unconfirmed hypothesis. Boisé-conservation constraint
   * is dominant: ≥30 % terrain must stay in Conservation (mandatory).
   */
  risque: 3,

  /**
   * 3 / 5 — 2nd project adopted 2026-03-24; référendaire approval period
   * opened 2026-04-01 (8-day window → ~2026-04-09). At investigation date
   * (2026-05-25) the final adoption status is unknown (no result fetched).
   * Timing window is open but outcome uncertain.
   */
  timing: 3,

  /**
   * 2 / 5 — 1 308 rôle records on the target streets: 1 306 RU + 2 CH, 0 TE
   * (terrain libre). Zone appears fully built. Lot-to-zone assignment is a
   * street-name hypothesis (not confirmed geometrically). Assemblage of
   * adjacent lots would be required for meaningful density.
   */
  faisabilite: 2,

  /**
   * 3 / 5 — MRC Beauharnois-Salaberry: 948 new residential units in 2024
   * (+22 % vs 2023, 79 % multirésidentiel). Écoquartier Champlain active
   * nearby. Vivaxcès 284 units @ 0.1 % vacancy rate. No zone-specific
   * transaction data (JLR/Centris = Tier C gap).
   */
  marche: 3,
};

const dossier1: OpportunityDossierT = OpportunityDossier.parse({
  id: "valleyfield-h609-4-regl150-49",
  title: "Zone H-609-4 — densification boisée conditionnelle",
  bylaw: "150-49",
  zone: "H-609-4",
  address: "Secteur Champlain / Saint-Jean-Baptiste / Salaberry, Salaberry-de-Valleyfield",

  lots: [
    {
      noLot: "4516943",
      superficie: "14 990 m²",
      usage: "RU — Résidentiel unifamilial",
      valeur: "1 311 600 $",
    },
    {
      noLot: "3818335",
      superficie: "8 561 m²",
      usage: "RU — Résidentiel unifamilial",
      valeur: "2 254 300 $",
    },
    {
      noLot: "4516958",
      superficie: "3 443 m²",
      usage: "RU — Résidentiel unifamilial",
      valeur: "842 600 $",
    },
    {
      noLot: "3817581",
      superficie: "1 645 m²",
      usage: "RU — Résidentiel unifamilial",
      valeur: "259 100 $",
    },
    {
      noLot: "3817940",
      superficie: "1 139 m²",
      usage: "RU — Résidentiel unifamilial",
      valeur: "216 400 $",
    },
  ],

  evidence: [
    // ── Phase: signal ──────────────────────────────────────────────────
    {
      phase: "signal",
      sourceId: "avis-consultation-150-49",
      label: "Avis public — assemblée de consultation règl. 150-49/150-50",
      url: "https://dua3m7xvptjbw.cloudfront.net/documents/avis/AP_150-49_150-50_assemblee_consultation.pdf",
      date: "2026-02-25",
      obtentionMode: "download",
      confidence: "high",
      verification: "fait",
      value: "Séance 10 fév. 2026; assemblée publique 11 mars 2026 (reportée au 23 mars); objet: encadrer urbanisation durable zones boisées. Zone H-609-4 créée à même H-609.",
    },
    {
      phase: "signal",
      sourceId: "avis-referendum-150-49",
      label: "Avis public — demande approbation référendaire 150-49/150-50 (2e projet)",
      url: "https://dua3m7xvptjbw.cloudfront.net/documents/avis/AP_personnes_interessees_referendum_150-49_150-50.pdf",
      date: "2026-04-01",
      obtentionMode: "download",
      confidence: "high",
      verification: "fait",
      value: "2e projet adopté 24 mars 2026. Période référendaire ouverte ~1-9 avril 2026. Articles 4-16 susceptibles d'approbation référendaire. Densité base 0,5 log/ha; option 50 log/ha si ≥30 % terrain conservé (usage Conservation).",
    },
    {
      phase: "signal",
      sourceId: "regl-150-49-texte",
      label: "Règlement 150-49 — art. 12.7 (texte normatif zone H-609-4)",
      url: "https://dua3m7xvptjbw.cloudfront.net/documents/reglements/Reglement-150-49-residuel.pdf",
      date: "2026-05-25",
      obtentionMode: "download",
      confidence: "high",
      verification: "fait",
      value: "Zone H-609-4: ouverture rue publique prohibée sauf si densité modulée selon proportion milieux naturels protégés (PIIA règl.153). Option 12.7.1: 50 log/ha si ≥30 % en Conservation. Bande continue min 20 % du terrain, profondeur ≥10 m et ≥1000 m².",
    },
    {
      phase: "signal",
      sourceId: "youtube-conseil-valleyfield",
      label: "YouTube — séances conseil municipal Valleyfield 2026 (transcription règl. 150-49)",
      url: "https://www.youtube.com/@VilleValleyfield",
      date: "2026-05-25",
      obtentionMode: "transcription",
      confidence: "low",
      verification: "non-disponible",
      value: "Transcriptions des séances 2026 non obtenues. Bloquer API YouTube (cookie requis). Méthode alternative: yt-dlp + Whisper ou Playwright/Obscura. Tier-B-partial.",
    },
    // ── Phase: ancrage ─────────────────────────────────────────────────
    {
      phase: "ancrage",
      sourceId: "role-70052-2026",
      label: "Rôle d'évaluation foncière 2026 — municipalité 70052 (XML 27 Mo)",
      url: "https://donneesouvertes.affmunqc.net/role/RL70052_2026.xml",
      date: "2026-05-25",
      obtentionMode: "download",
      confidence: "high",
      verification: "fait",
      value: "5 lots RU identifiés sur rues SALABERRY/SAINT-JEAN-BAPTISTE/CHAMPLAIN/LALONDE/BESNER: NO_LOT 4516943 (14990m², 1311600$), 3818335 (8561m², 2254300$), 4516958 (3443m², 842600$), 3817581 (1645m², 259100$), 3817940 (1139m², 216400$). 1308 enregistrements totaux sur ces rues: 0 TE (terrain libre). Rôle 2026 date réf. 2024-07-01.",
    },
    {
      phase: "ancrage",
      sourceId: "cadastre-allege-rest",
      label: "Cadastre allégé du Québec — API REST (présence 15/15 lots vérifiés)",
      url: "https://geo.environnement.gouv.qc.ca/donnees/rest/services/Reference/Cadastre_allege/MapServer/0",
      date: "2026-05-25",
      obtentionMode: "api",
      confidence: "high",
      verification: "fait",
      value: "Tous les 5 lots vérifiés présents dans le cadastre allégé via requête REST ESRI (HTTP 200). Géométrie disponible en EPSG:3857.",
    },
    {
      phase: "ancrage",
      sourceId: "lot-zone-correspondance-h609-4",
      label: "Correspondance lot ↔ zone H-609-4 (hypothèse par nom de rue)",
      date: "2026-05-25",
      obtentionMode: "manual",
      confidence: "medium",
      verification: "hypothese",
      value: "Lots sélectionnés par correspondance nom de rue (champ RL0101Gx du rôle) avec les rues citées dans les briefs de l'opportunité. Le rôle ne contient pas directement le code de zone. L'intersection géométrique exacte nécessite le plan Annexe B du règl. 150-49 (PDF disponible, non parsé). Polygones de zone H-609-4 non disponibles en open data vectoriel.",
    },
    // ── Phase: contraintes ─────────────────────────────────────────────
    {
      phase: "contraintes",
      sourceId: "bdzi-rest-h609-4",
      label: "BDZI — zones inondables (REST ArcGIS layer 22) — H-609-4",
      url: "https://www.servicesgeo.enviroweb.gouv.qc.ca/donnees/rest/services/Public/Themes_publics/MapServer/22/query",
      date: "2026-05-25",
      obtentionMode: "api",
      confidence: "high",
      verification: "fait",
      value: "0 polygone BDZI retourné dans la bbox ville Valleyfield et bbox élargie région. Aucune zone inondable BDZI intersectant H-609-4. Les ZIS de 2019 (partiellement levées déc. 2019) visaient des parcs publics, non les zones résidentielles ciblées.",
    },
    {
      phase: "contraintes",
      sourceId: "grhq-rest-h609-4",
      label: "GRHQ — hydrographie (REST layer 104) — secteur H-609-4",
      url: "https://www.servicesgeo.enviroweb.gouv.qc.ca/donnees/rest/services/Public/Themes_publics/MapServer/104/query",
      date: "2026-05-25",
      obtentionMode: "api",
      confidence: "medium",
      verification: "fait",
      value: "328 éléments hydrographiques dans la bbox ville entière. Aucun grand plan d'eau (≥5 ha) identifié spécifiquement dans la sous-bbox H-609-4. Présence probable de ruisseaux/fossés urbains. Contrainte GRHQ moindre que Grande-Île.",
    },
    {
      phase: "contraintes",
      sourceId: "cptaq-a939-h609-4",
      label: "CPTAQ — zone agricole A-939 (Feuillet-1 + Zones-A-150-44.pdf) adjacente à H-609",
      url: "https://dua3m7xvptjbw.cloudfront.net/documents/reglements/Reglement-150-codifie-Annexe-A-Zones-A-Agricoles-150-44.pdf",
      date: "2026-05-25",
      obtentionMode: "download",
      confidence: "medium",
      verification: "hypothese",
      value: "Zone A-939 (ancienne A-1103/Ag2, LPTA actif) observée adjacente à H-609 sur Feuillet-1. L'appartenance précise de H-609-4 à la sous-zone mitoyenne de A-939 n'est pas confirmée géométriquement (polygones vectoriels non disponibles). Si lots H-609-4 touchent A-939, une demande CPTAQ est requise avant subdivision/développement.",
    },
    // ── Phase: marche ──────────────────────────────────────────────────
    {
      phase: "marche",
      sourceId: "neomedia-mrc-bhs-2024",
      label: "NeoMedia — permis de construction résidentiels MRC Beauharnois-Salaberry 2024",
      url: "https://www.neomedia.com/vaudreuil-soulanges/actualites/valleyfield/636153/2024-croissance-des-permis-de-construction-residentielle-dans-la-mrc-de-beauharnois-salaberry",
      date: "2026-05-25",
      obtentionMode: "scraping",
      confidence: "high",
      verification: "fait",
      value: "948 nouvelles unités résidentielles MRC 2024 (+22 % vs 2023, 79 % multirésidentiel). Investissements totaux 421 M$. Données propres à Salaberry-de-Valleyfield non disponibles (article MRC global).",
    },
    {
      phase: "marche",
      sourceId: "valleyfield-projets-residentiels",
      label: "Ville Valleyfield — projets résidentiels en développement",
      url: "https://www.ville.valleyfield.qc.ca/projets-residentiels-et-multifamiliaux",
      date: "2026-05-25",
      obtentionMode: "scraping",
      confidence: "medium",
      verification: "fait",
      value: "Projets actifs: Écoquartier Champlain (Champlain, condos/unifamilial/multifamilial/commercial), Quartier urbain 395 (Champlain), Projet Marleau 53 unités (Champlain). Aucun projet explicitement en zone H-609-4.",
    },
    {
      phase: "marche",
      sourceId: "jlr-centris-transactions",
      label: "JLR / Centris — transactions notariées et prix médians par zone",
      date: "2026-05-25",
      obtentionMode: "manual",
      confidence: "low",
      verification: "non-disponible",
      value: "Données payantes (JLR, Centris/MLS). Non accessibles sans abonnement. Gap documenté Tier C.",
    },
    // ── Phase: contexte ────────────────────────────────────────────────
    {
      phase: "contexte",
      sourceId: "statcan-2021-valleyfield",
      label: "Statistique Canada — Recensement 2021 — Salaberry-de-Valleyfield",
      url: "https://www12.statcan.gc.ca/census-recensement/2021/dp-pd/prof/details/page.cfm?Lang=E&SearchText=Salaberry-de-Valleyfield&GENDERlist=1,2,3&STATISTIClist=1&DGUIDlist=2021A00052470052&HEADERlist=0",
      date: "2026-05-25",
      obtentionMode: "scraping",
      confidence: "medium",
      verification: "fait",
      value: "Population 2021: 42 787 (+5 % vs 2016). 20 073 logements privés occupés. Revenu médian ménages après impôt 54 800 $. Propriétaires 55,3 %, locataires 44,7 %. Âge médian 48,3 ans. Note: pages StatCan retournent 404 en accès direct (mai 2026); valeurs indexées via Google.",
    },
    {
      phase: "contexte",
      sourceId: "infosuroit-padtc",
      label: "INFOSuroit — PADTC transport collectif Valleyfield 574 762 $",
      url: "https://www.infosuroit.com/pres-de-600-000-dollars-a-salaberry-de-valleyfield-pour-le-transport-collectif/",
      date: "2026-05-25",
      obtentionMode: "scraping",
      confidence: "high",
      verification: "fait",
      value: "Programme PADTC: 574 762 $ annoncés le 16 déc. 2024 pour renforcer le réseau TC. Améliore l'accessibilité du secteur résidentiel.",
    },
    // ── Phase: scoring ─────────────────────────────────────────────────
    {
      phase: "scoring",
      sourceId: "scoring-h609-4",
      label: "Synthèse scoring — H-609-4 règl. 150-49",
      date: "2026-05-25",
      obtentionMode: "manual",
      confidence: "medium",
      verification: "hypothese",
      value: "potentiel=4 (fort potentiel réglementaire, conditionnel PIIA+boisé), risque=3 (CPTAQ A-939 hypothèse, pas d'inondable), timing=3 (référendaire ouvert ~avr. 2026, résultat inconnu), faisabilite=2 (0 TE, zone bâtie, assemblage requis), marche=3 (MRC +22 %, Champlain actif). scoreGlobal=3.15.",
    },
  ],

  scores: scores1,
  scoreGlobal: weightedScore(scores1),
  recommendation:
    "Surveiller — fort potentiel réglementaire (50 log/ha avec PIIA) mais la zone est entièrement bâtie (0 terrain libre au rôle 2026), l'assemblage est coûteux, et l'issue référendaire du règl. 150-49 n'est pas confirmée. À qualifier avec expert foncier une fois le règlement adopté définitivement et un lot d'assemblage identifié.",
});

// ─────────────────────────────────────────────────────────────────────────────
// Dossier 2 — U-521 → H-521 / règl. 150-51
// ─────────────────────────────────────────────────────────────────────────────

const scores2 = {
  /**
   * 4 / 5 — Conversion from utilité publique (U-521) to résidentiel (H-521),
   * adding habitations multifamiliales 8 log., 3 étages max, 12 m, structure
   * isolée et jumelée. Strongest conversion type: from zero residential to
   * multifamilial. Art. 14 confirms same perimeter.
   * Source: règl. 150-51 art.7 + art.14; avis référendaire 22 avr. 2026.
   */
  potentiel: 4,

  /**
   * 2 / 5 — BDZI: 0 polygones dans bbox centre-ville (high confidence).
   * GRHQ: plan d'eau 159 ha (probable canal) détecté dans bbox H-521 —
   * bandes riveraines 10-15 m si lots adjacents (hypothèse non confirmée
   * géométriquement). CPTAQ: A-912 (LPTA) adjacent sur Feuillet-2 —
   * intersection précise non confirmée. Double contrainte hypothétique.
   */
  risque: 2,

  /**
   * 4 / 5 — 2nd project adopted 2026-04-14. Référendaire approval notice
   * published 2026-04-22; 8-day period → ~2026-04-30. Règlement 150-49-1
   * (same adoption date) completed its PHV certificate. Timing window very
   * close — process most advanced of the three dossiers.
   */
  timing: 4,

  /**
   * 3 / 5 — Lot 4516554 (SAINTE-MARIE, 17 866 m², BO) is the most
   * interesting candidate: large, no civic number, usage BO (bureau) in
   * zone U (utilité publique) → conversion target. Lot attribution to zone
   * U-521 is a street-name hypothesis. Côté Lanctôt/Cossette confirmed by
   * règl. 150-51 text.
   */
  faisabilite: 3,

  /**
   * 3 / 5 — Same MRC context (+22 % 2024, 79 % multirésidentiel). Urban
   * central location premium. Place Carrière 120 condos active nearby.
   * No zone-specific transaction data (Tier C gap).
   */
  marche: 3,
};

const dossier2: OpportunityDossierT = OpportunityDossier.parse({
  id: "valleyfield-u521-h521-regl150-51",
  title: "Zone U-521 → H-521 — conversion utilité publique vers résidentiel",
  bylaw: "150-51",
  zone: "H-521",
  address: "Secteur Lanctôt / Cossette / Larocque / Sainte-Marie, Salaberry-de-Valleyfield",

  lots: [
    {
      noLot: "4516554",
      superficie: "17 866 m²",
      usage: "BO — Bureau/commercial",
      valeur: "89 400 $",
    },
    {
      noLot: "4514460",
      superficie: "11 360 m²",
      usage: "CH — Chalet/villégiature",
      valeur: "1 212 400 $",
    },
    {
      noLot: "4514434",
      superficie: "3 548 m²",
      usage: "RU — Résidentiel unifamilial",
      valeur: "425 600 $",
    },
    {
      noLot: "5952129",
      superficie: "1 873 m²",
      usage: "RU — Résidentiel unifamilial",
      valeur: "276 300 $",
    },
    {
      noLot: "3819614",
      superficie: "768 m²",
      usage: "RU — Résidentiel unifamilial",
      valeur: "190 100 $",
    },
  ],

  evidence: [
    // ── Phase: signal ──────────────────────────────────────────────────
    {
      phase: "signal",
      sourceId: "avis-referendum-150-51",
      label: "Avis public — approbation référendaire 150-51 (2e projet)",
      url: "https://dua3m7xvptjbw.cloudfront.net/documents/avis/Avis-public-Approbation-referendaire-150-51.pdf",
      date: "2026-04-22",
      obtentionMode: "download",
      confidence: "high",
      verification: "fait",
      value: "Règl. 150-51 2e projet adopté 14 avr. 2026. Objet: modification zones et normes. Zone U-521 → H-521 (secteur rues Lanctôt et Cossette). Habitations multifamiliales 8 log., structure isolée/jumelée, 3 étages max, hauteur 12 m. Zones contigues: P-520, H-516, H-519, H-518, H-524, H-522. Période référendaire ~22-30 avr. 2026.",
    },
    {
      phase: "signal",
      sourceId: "regl-150-51-texte",
      label: "Règlement 150-51 — art. 7 et art. 14 (rezonage U-521 → H-521)",
      url: "https://dua3m7xvptjbw.cloudfront.net/documents/reglements/Reglement-150-51-zonage.pdf",
      date: "2026-05-25",
      obtentionMode: "download",
      confidence: "high",
      verification: "fait",
      value: "Art.7: grille usages U-521 remplacée par grille H-521. Art.14: désignation U-521 remplacée par H-521 EN CONSERVANT LES MÊMES LIMITES. Grille complète H-521 (stationnement, marges, surface plancher) non disponible — règl. 150-51 adopté non publié en PDF au dépôt public au 2026-05-25.",
    },
    {
      phase: "signal",
      sourceId: "zones-u-150-47",
      label: "Zones U — utilité publique (grille actuelle U-521 pré-rezonage)",
      url: "https://dua3m7xvptjbw.cloudfront.net/documents/reglements/Zones-U-Utilite-publique-150-47.pdf",
      date: "2026-05-25",
      obtentionMode: "download",
      confidence: "high",
      verification: "fait",
      value: "Zone U-521 actuelle: utilité publique (ancienne U-702B), usage p4b (service public relié à production). Aucun usage résidentiel permis. Marges avant min 6 m, rapport espace bâtiment/terrain max 0,45. Aucune norme logements/hectare.",
    },
    {
      phase: "signal",
      sourceId: "youtube-conseil-valleyfield",
      label: "YouTube — séances conseil municipal Valleyfield 2026 (transcription règl. 150-51)",
      url: "https://www.youtube.com/@VilleValleyfield",
      date: "2026-05-25",
      obtentionMode: "transcription",
      confidence: "low",
      verification: "non-disponible",
      value: "Transcriptions des séances 2026 non obtenues. Même bloqueur que dossier H-609-4. Tier-B-partial.",
    },
    // ── Phase: ancrage ─────────────────────────────────────────────────
    {
      phase: "ancrage",
      sourceId: "role-70052-2026",
      label: "Rôle d'évaluation foncière 2026 — lots zone U-521 (rues Larocque/Sainte-Marie/Saint-François/Maisonneuve/Jeanne-Mance)",
      url: "https://donneesouvertes.affmunqc.net/role/RL70052_2026.xml",
      date: "2026-05-25",
      obtentionMode: "download",
      confidence: "high",
      verification: "fait",
      value: "5 lots identifiés: NO_LOT 4516554 (SAINTE-MARIE sans no civique, BO, 17866m², 89400$), 4514460 (683 LAROCQUE, CH, 11360m², 1212400$), 4514434 (JEANNE-MANCE sans no civique, RU, 3548m², 425600$), 5952129 (389 MAISONNEUVE, RU, 1873m², 276300$), 3819614 (105 SAINT-FRANCOIS, RU, 768m², 190100$). 515 enregistrements totaux: CH 218, BO 126, RU 181.",
    },
    {
      phase: "ancrage",
      sourceId: "cadastre-allege-rest",
      label: "Cadastre allégé — présence lots U-521 vérifiée",
      url: "https://geo.environnement.gouv.qc.ca/donnees/rest/services/Reference/Cadastre_allege/MapServer/0",
      date: "2026-05-25",
      obtentionMode: "api",
      confidence: "high",
      verification: "fait",
      value: "Tous les 5 lots vérifiés présents dans le cadastre allégé via REST ESRI.",
    },
    {
      phase: "ancrage",
      sourceId: "lot-zone-correspondance-u521",
      label: "Correspondance lot ↔ zone U-521 (hypothèse par nom de rue + confirmation art.14)",
      date: "2026-05-25",
      obtentionMode: "manual",
      confidence: "medium",
      verification: "hypothese",
      value: "Lots sélectionnés par nom de rue. Art.14 du règl. 150-51 confirme que U-521/H-521 conserve les mêmes limites géographiques. Description textuelle du règl. 150-51: secteur rues Lanctôt et Cossette. SAINTE-MARIE (lot 4516554) et LAROCQUE (4514460) sont dans la zone d'influence mais l'appartenance précise à U-521 vs zones adjacentes (H-516, H-519...) n'est pas confirmée géométriquement.",
    },
    // ── Phase: contraintes ─────────────────────────────────────────────
    {
      phase: "contraintes",
      sourceId: "bdzi-rest-u521",
      label: "BDZI — zones inondables (REST layer 22) — secteur H-521/U-521",
      url: "https://www.servicesgeo.enviroweb.gouv.qc.ca/donnees/rest/services/Public/Themes_publics/MapServer/22/query",
      date: "2026-05-25",
      obtentionMode: "api",
      confidence: "high",
      verification: "fait",
      value: "0 polygone BDZI dans la bbox centre-ville secteur Lanctôt/Cossette. Aucune zone inondable BDZI identifiée pour cette zone.",
    },
    {
      phase: "contraintes",
      sourceId: "grhq-rest-u521",
      label: "GRHQ — plan d'eau 159 ha détecté dans bbox H-521 (probable canal de Valleyfield)",
      url: "https://www.servicesgeo.enviroweb.gouv.qc.ca/donnees/rest/services/Public/Themes_publics/MapServer/104/query",
      date: "2026-05-25",
      obtentionMode: "api",
      confidence: "medium",
      verification: "hypothese",
      value: "Plan d'eau TYPECE 10, 159 ha, bbox [lon -74.13,-74.04 / lat 45.26,45.29] détecté dans bbox H-521. Probable canal de Valleyfield. Si lots H-521 sont en bordure directe, bandes riveraines 10-15 m (PPRLPI) réduisent superficie constructible. Intersection géométrique précise H-521/plan d'eau NON CONFIRMÉE.",
    },
    {
      phase: "contraintes",
      sourceId: "cptaq-a912-u521",
      label: "CPTAQ — zone agricole A-912 (Feuillet-2 + Zones-A-150-44.pdf) adjacente à U-521",
      url: "https://dua3m7xvptjbw.cloudfront.net/documents/reglements/Reglement-150-codifie-Annexe-A-Zones-A-Agricoles-150-44.pdf",
      date: "2026-05-25",
      obtentionMode: "download",
      confidence: "medium",
      verification: "hypothese",
      value: "Zone A-912 (ancienne Ags-7, LPTA actif) observée adjacente à U-521 sur Feuillet-2. Le règl. 150-51 prévoit du multifamilial côté Est chemin Larocque (C-627) davantage côté ville. Si lots U-521/H-521 touchent A-912, une autorisation CPTAQ est requise. Intersection géométrique NON CONFIRMÉE.",
    },
    // ── Phase: marche ──────────────────────────────────────────────────
    {
      phase: "marche",
      sourceId: "neomedia-mrc-bhs-2024",
      label: "NeoMedia — permis de construction MRC Beauharnois-Salaberry 2024",
      url: "https://www.neomedia.com/vaudreuil-soulanges/actualites/valleyfield/636153/2024-croissance-des-permis-de-construction-residentielle-dans-la-mrc-de-beauharnois-salaberry",
      date: "2026-05-25",
      obtentionMode: "scraping",
      confidence: "high",
      verification: "fait",
      value: "948 unités 2024 (+22 % vs 2023). Données spécifiques à Valleyfield non disponibles.",
    },
    {
      phase: "marche",
      sourceId: "vivaxces-valleyfield",
      label: "Journal Le Saint-François — Vivaxcès Valleyfield (Lokalia, 284 unités, taux inoccupation 0,1 %)",
      url: "https://journalsaint-francois.ca/un-projet-phare-pour-le-logement-a-salaberry-de-valleyfield/",
      date: "2026-05-25",
      obtentionMode: "scraping",
      confidence: "high",
      verification: "fait",
      value: "Lokalia, secteur nord, 284 unités (~60 abordables), 10 étages, ~60 M$, livraison prévue juil. 2025. Taux d'inoccupation 0,1 % au moment de l'article. Zone exacte non précisée.",
    },
    {
      phase: "marche",
      sourceId: "jlr-centris-transactions",
      label: "JLR / Centris — transactions par zone",
      date: "2026-05-25",
      obtentionMode: "manual",
      confidence: "low",
      verification: "non-disponible",
      value: "Données payantes. Gap documenté Tier C.",
    },
    // ── Phase: contexte ────────────────────────────────────────────────
    {
      phase: "contexte",
      sourceId: "statcan-2021-valleyfield",
      label: "Statistique Canada — Recensement 2021 — Salaberry-de-Valleyfield",
      url: "https://www12.statcan.gc.ca/census-recensement/2021/dp-pd/prof/details/page.cfm?Lang=E&SearchText=Salaberry-de-Valleyfield&GENDERlist=1,2,3&STATISTIClist=1&DGUIDlist=2021A00052470052&HEADERlist=0",
      date: "2026-05-25",
      obtentionMode: "scraping",
      confidence: "medium",
      verification: "fait",
      value: "Population 2021: 42 787 (+5 % vs 2016). Revenu médian ménages 54 800 $. Propriétaires 55,3 %.",
    },
    {
      phase: "contexte",
      sourceId: "valleyfield-plan-urbanisme",
      label: "Ville Valleyfield — Plan d'urbanisme entré en vigueur 2024",
      url: "https://www.ville.valleyfield.qc.ca/plan-urbanisme",
      date: "2026-05-25",
      obtentionMode: "scraping",
      confidence: "medium",
      verification: "fait",
      value: "Nouveau plan d'urbanisme entré en vigueur 2024. 5 enjeux dont: environnement résidentiel/logement/densité; durabilité environnementale; transport et mobilité active. Cibles quantifiées non publiées.",
    },
    // ── Phase: scoring ─────────────────────────────────────────────────
    {
      phase: "scoring",
      sourceId: "scoring-u521-h521",
      label: "Synthèse scoring — U-521 → H-521 règl. 150-51",
      date: "2026-05-25",
      obtentionMode: "manual",
      confidence: "medium",
      verification: "hypothese",
      value: "potentiel=4 (conversion forte U→H, multifamilial 8 log.), risque=2 (plan d'eau 159 ha hypothèse + A-912 CPTAQ hypothèse), timing=4 (règl. adopté avr. 2026, référendaire ~terminé), faisabilite=3 (lot BO 17866m² disponible, attribution zone hypothèse), marche=3 (MRC +22 %, Vivaxcès 0,1 % inoccupation). scoreGlobal=3.30.",
    },
  ],

  scores: scores2,
  scoreGlobal: weightedScore(scores2),
  recommendation:
    "Qualifier avec expert — conversion U→H dans un secteur urbain central avec lot BO large (17 866 m²) disponible, rezonage le plus avancé des trois (procédure référendaire ~terminée avr. 2026). Vérifier en priorité: (1) lot 4516554 appartient-il effectivement à U-521 (plan cadastral)? (2) bandes riveraines canal 159 ha applicables? (3) A-912 CPTAQ: lot côté Lanctôt/Cossette vs côté Est Larocque.",
});

// ─────────────────────────────────────────────────────────────────────────────
// Dossier 3 — H-143 / H-143-1 / règl. 150-49-1
// ─────────────────────────────────────────────────────────────────────────────

const scores3 = {
  /**
   * 3 / 5 — règl. 150-49-1 creates H-143-1 within H-143: density up to
   * 50 log/ha at ≥30 % conservation (H-143), but H-143-1 is more restrictive
   * (2 log/ha at 55 % or 15 log/ha at 70 % conservation). Strong potential
   * in H-143 core, significantly limited in H-143-1 sub-zone.
   * Source: règl. 150-49-1 art.12.7; avis registre 150-49-1 22 avr. 2026.
   */
  potentiel: 3,

  /**
   * 1 / 5 — GRHQ: 512 hydrographic elements in Grande-Île bbox; Lac
   * Saint-François (28 191 ha) + plans d'eau 1600 ha and 159 ha bordier.
   * PPRLPI bands 10-15 m on all permanent watercourses (94 permanent elements).
   * CPTAQ: A-118 DIRECTLY adjacent to H-143 — explicitly confirmed in the
   * 150-49-1 registre notice (listed as contiguous zone). A-118 is LPTA.
   * règl. 150-49 creates A-118-1 as explicit conservation buffer → confirms
   * the Ville acknowledges CPTAQ pressure. Double bloquant (GRHQ + CPTAQ).
   */
  risque: 1,

  /**
   * 4 / 5 — règl. 150-49-1 adopted 2026-04-14. Registre 28 avril 2026
   * (22 signatures required to trigger a referendum). Certificate PHV
   * (procédure habilitante de vote) filed — procedure completed. This is
   * the most legally advanced of the three bylaws.
   */
  timing: 4,

  /**
   * 2 / 5 — Large lots exist: 3247200 (MGR-LANGLOIS, 19 680 m², BO) and
   * 6527169 (LECOMPTE, 12 612 m², AV). But CPTAQ adjacency + GRHQ riverain
   * constraints severely limit buildable area on riverfront lots. Zone
   * attribution is a street-name hypothesis. Conservation mandate is heavy.
   */
  faisabilite: 2,

  /**
   * 3 / 5 — Same MRC context (+22 % 2024). Riverain premium (Saint-Laurent
   * waterfront), but tempered by heavy constraints (CPTAQ + GRHQ). No
   * zone-specific transaction data (Tier C gap).
   */
  marche: 3,
};

const dossier3: OpportunityDossierT = OpportunityDossier.parse({
  id: "valleyfield-h143-h143-1-regl150-49-1",
  title: "Zones H-143 / H-143-1 — urbanisation durable Grande-Île (densité conditionnelle)",
  bylaw: "150-49-1",
  zone: "H-143 / H-143-1",
  address: "Secteur Grande-Île / Mgr-Langlois / Ovide / Patriotes, Salaberry-de-Valleyfield",

  lots: [
    {
      noLot: "3247200",
      superficie: "19 680 m²",
      usage: "BO — Bureau/commercial",
      valeur: "2 985 100 $",
    },
    {
      noLot: "6527169",
      superficie: "12 612 m²",
      usage: "AV — Immeuble locatif/appartements",
      valeur: "908 000 $",
    },
    {
      noLot: "3595639",
      superficie: "7 263 m²",
      usage: "AV — Immeuble locatif/appartements",
      valeur: "892 500 $",
    },
    {
      noLot: "5139121",
      superficie: "1 660 m²",
      usage: "RU — Résidentiel unifamilial",
      valeur: "239 500 $",
    },
    {
      noLot: "3595656",
      superficie: "1 298 m²",
      usage: "RU — Résidentiel unifamilial",
      valeur: "299 600 $",
    },
  ],

  evidence: [
    // ── Phase: signal ──────────────────────────────────────────────────
    {
      phase: "signal",
      sourceId: "avis-registre-150-49-1",
      label: "Avis public — procédure de demande de scrutin référendaire — règl. 150-49-1",
      url: "https://dua3m7xvptjbw.cloudfront.net/documents/avis/AP_Avis-Registre-150-49-1.pdf",
      date: "2026-04-22",
      obtentionMode: "download",
      confidence: "high",
      verification: "fait",
      value: "Règl. 150-49-1 adopté 14 avr. 2026. Objet: encadrer urbanisation durable H-143 — développement immobilier arrimé à la protection des espaces boisés. Zone H-143 (à l'ouest de la rue Nicolas, au nord des tours Hydro-Québec). Zones contigues: A-118, C-144, H-149, P-173, P-142. Registre 28 avr. 2026 (9h-19h, salle conseil 61 rue Sainte-Cécile), seuil 22 signatures. Résultat publié 29 avr. 2026 8h30 sur site Ville.",
    },
    {
      phase: "signal",
      sourceId: "avis-referendum-150-49",
      label: "Avis public — règl. 150-49 — normes H-143 et H-143-1 (même règlement parent)",
      url: "https://dua3m7xvptjbw.cloudfront.net/documents/avis/AP_personnes_interessees_referendum_150-49_150-50.pdf",
      date: "2026-04-01",
      obtentionMode: "download",
      confidence: "high",
      verification: "fait",
      value: "H-143: densité base 0,5 log/ha; option 50 log/ha si ≥30 % protégé en Conservation. H-143-1: option 2 log/ha si 55 % protégé; option 15 log/ha si 70 % protégé. Bande continue minimum 20 % du terrain. A-118-1 (nouvelle zone) créée comme zone tampon entre H-143/H-143-1 et A-118.",
    },
    {
      phase: "signal",
      sourceId: "youtube-conseil-valleyfield",
      label: "YouTube — séances conseil municipal Valleyfield 2026 (transcription règl. 150-49-1)",
      url: "https://www.youtube.com/@VilleValleyfield",
      date: "2026-05-25",
      obtentionMode: "transcription",
      confidence: "low",
      verification: "non-disponible",
      value: "Transcriptions des séances 2026 non obtenues. Bloqueur identique aux deux autres dossiers. Tier-B-partial.",
    },
    // ── Phase: ancrage ─────────────────────────────────────────────────
    {
      phase: "ancrage",
      sourceId: "role-70052-2026",
      label: "Rôle d'évaluation foncière 2026 — lots zone H-143 (rues Mgr-Langlois/Lecompte/Grande-Île/Gosselin/Patriotes)",
      url: "https://donneesouvertes.affmunqc.net/role/RL70052_2026.xml",
      date: "2026-05-25",
      obtentionMode: "download",
      confidence: "high",
      verification: "fait",
      value: "5 lots identifiés: NO_LOT 3247200 (1620 MGR-LANGLOIS, BO, 19680m², 2985100$), 6527169 (LECOMPTE sans no civique, AV, 12612m², 908000$), 3595639 (748 GRANDE-ILE, AV, 7263m², 892500$), 5139121 (GOSSELIN sans no civique, RU, 1660m², 239500$), 3595656 (751 PATRIOTES, RU, 1298m², 299600$). 650 enregistrements totaux sur ces rues: AV 244, BO 187, RU 231.",
    },
    {
      phase: "ancrage",
      sourceId: "cadastre-allege-rest",
      label: "Cadastre allégé — présence lots H-143 vérifiée",
      url: "https://geo.environnement.gouv.qc.ca/donnees/rest/services/Reference/Cadastre_allege/MapServer/0",
      date: "2026-05-25",
      obtentionMode: "api",
      confidence: "high",
      verification: "fait",
      value: "Tous les 5 lots vérifiés présents dans le cadastre allégé via REST ESRI.",
    },
    {
      phase: "ancrage",
      sourceId: "lot-zone-correspondance-h143",
      label: "Correspondance lot ↔ zone H-143/H-143-1 (hypothèse par nom de rue)",
      date: "2026-05-25",
      obtentionMode: "manual",
      confidence: "medium",
      verification: "hypothese",
      value: "Lots sélectionnés par nom de rue. Zone H-143-1 créée à même une partie de H-143 (art.5 règl. 150-49-1). L'affectation précise de chaque lot à H-143 vs H-143-1 nécessite le plan Annexe A du règl. 150-49-1 (PDF disponible, non parsé géométriquement). Polygones vectoriels non disponibles en open data.",
    },
    // ── Phase: contraintes ─────────────────────────────────────────────
    {
      phase: "contraintes",
      sourceId: "bdzi-rest-h143",
      label: "BDZI — zones inondables (REST layer 22) — Grande-Île / H-143",
      url: "https://www.servicesgeo.enviroweb.gouv.qc.ca/donnees/rest/services/Public/Themes_publics/MapServer/22/query",
      date: "2026-05-25",
      obtentionMode: "api",
      confidence: "high",
      verification: "fait",
      value: "0 polygone BDZI dans la bbox Grande-Île (lat 45.25-45.32). Aucune zone inondable BDZI cartographiée pour ce secteur. MISE EN GARDE: le secteur riverain Saint-Laurent n'est pas formellement cartographié dans la BDZI; une étude CEHQ locale pourrait exister hors BDZI. ZIS 2019 (partiellement levées déc. 2019) visaient des parcs publics spécifiques, non les zones H.",
    },
    {
      phase: "contraintes",
      sourceId: "grhq-rest-h143-grande-ile",
      label: "GRHQ — hydrographie dense Grande-Île (512 éléments, Saint-Laurent, PPRLPI)",
      url: "https://www.servicesgeo.enviroweb.gouv.qc.ca/donnees/rest/services/Public/Themes_publics/MapServer/101/query",
      date: "2026-05-25",
      obtentionMode: "api",
      confidence: "high",
      verification: "fait",
      value: "512 éléments linéaires dans bbox Grande-Île (297 TYPECE 10, 131 TYPECE 23, 94 permanents PERENNITE P). Lac Saint-François 28191 ha, plans d'eau 1600 ha et 159 ha en bordure immédiate. Le quartier Grande-Île borde le fleuve Saint-Laurent. PPRLPI: bandes riveraines 10-15 m obligatoires sur tous les cours d'eau permanents. CONTRAINTE BLOQUANTE pour lots riverains, COÛTEUSE pour lots intérieurs.",
    },
    {
      phase: "contraintes",
      sourceId: "cptaq-a118-h143-direct",
      label: "CPTAQ — zone agricole A-118 DIRECTEMENT adjacente à H-143 (confirmation officielle avis registre 150-49-1)",
      url: "https://dua3m7xvptjbw.cloudfront.net/documents/avis/AP_Avis-Registre-150-49-1.pdf",
      date: "2026-04-22",
      obtentionMode: "download",
      confidence: "high",
      verification: "fait",
      value: "Avis de registre 150-49-1 liste explicitement les zones contigues de H-143: A-118, C-144, H-149, P-173, P-142. A-118 (ancienne zone A15) est dans la zone agricole provinciale LPTA (confirmé Zones-A-150-44.pdf). règl. 150-49 crée A-118-1 comme zone de conservation tampon entre H-143-1 et A-118 — preuve que la Ville reconnaît cette contrainte CPTAQ et y répond. CONTRAINTE BLOQUANTE aux abords de la limite A-118; COÛTEUSE pour le reste de H-143.",
    },
    {
      phase: "contraintes",
      sourceId: "cptaq-zones-a-150-44",
      label: "CPTAQ — Zones-A-Agricoles-150-44.pdf (toutes zones A comportent LPTA)",
      url: "https://dua3m7xvptjbw.cloudfront.net/documents/reglements/Reglement-150-codifie-Annexe-A-Zones-A-Agricoles-150-44.pdf",
      date: "2026-05-25",
      obtentionMode: "download",
      confidence: "high",
      verification: "fait",
      value: "Toutes les zones A du règl. 150 (A-118, A-135, A-163, A-832, A-912, A-939, etc.) comportent la disposition spéciale LPTA (LRQ c.P-41). Toute subdivision, changement d'utilisation ou construction à la limite de A-118 requiert une autorisation CPTAQ.",
    },
    // ── Phase: marche ──────────────────────────────────────────────────
    {
      phase: "marche",
      sourceId: "neomedia-mrc-bhs-2024",
      label: "NeoMedia — permis de construction MRC Beauharnois-Salaberry 2024",
      url: "https://www.neomedia.com/vaudreuil-soulanges/actualites/valleyfield/636153/2024-croissance-des-permis-de-construction-residentielle-dans-la-mrc-de-beauharnois-salaberry",
      date: "2026-05-25",
      obtentionMode: "scraping",
      confidence: "high",
      verification: "fait",
      value: "948 unités 2024 (+22 % vs 2023). Données spécifiques Valleyfield non disponibles.",
    },
    {
      phase: "marche",
      sourceId: "jlr-centris-transactions",
      label: "JLR / Centris — transactions par zone (riverain Saint-Laurent)",
      date: "2026-05-25",
      obtentionMode: "manual",
      confidence: "low",
      verification: "non-disponible",
      value: "Données payantes. Gap documenté Tier C. Le premium riverain Saint-Laurent pour les lots de Grande-Île n'est pas quantifiable via les sources open data.",
    },
    // ── Phase: contexte ────────────────────────────────────────────────
    {
      phase: "contexte",
      sourceId: "statcan-2021-valleyfield",
      label: "Statistique Canada — Recensement 2021 — Salaberry-de-Valleyfield",
      url: "https://www12.statcan.gc.ca/census-recensement/2021/dp-pd/prof/details/page.cfm?Lang=E&SearchText=Salaberry-de-Valleyfield&GENDERlist=1,2,3&STATISTIClist=1&DGUIDlist=2021A00052470052&HEADERlist=0",
      date: "2026-05-25",
      obtentionMode: "scraping",
      confidence: "medium",
      verification: "fait",
      value: "Population 2021: 42 787 (+5 % vs 2016). Revenu médian ménages 54 800 $. Grande-Île: quartier annexé en 2002, caractère insulaire.",
    },
    {
      phase: "contexte",
      sourceId: "valleyfield-projets-berges",
      label: "Ville Valleyfield — réfection des berges / Parc Marcil (catalyseurs riverains)",
      url: "https://www.ville.valleyfield.qc.ca/projets",
      date: "2026-05-25",
      obtentionMode: "scraping",
      confidence: "medium",
      verification: "fait",
      value: "Réfection des berges Baie Saint-François: pertinence forte pour projets premium en bordure d'eau. Métamorphose Parc Marcil (reconversion dépotoir en parc boisé): forte pertinence pour valorisation du secteur boisé/riverain. PPU secteur Moco: cadre de planification structurant.",
    },
    // ── Phase: scoring ─────────────────────────────────────────────────
    {
      phase: "scoring",
      sourceId: "scoring-h143-h143-1",
      label: "Synthèse scoring — H-143/H-143-1 règl. 150-49-1",
      date: "2026-05-25",
      obtentionMode: "manual",
      confidence: "medium",
      verification: "hypothese",
      value: "potentiel=3 (fort en H-143 core, très contraint en H-143-1 sous-zone), risque=1 (double bloquant: GRHQ 512 éléments Saint-Laurent + CPTAQ A-118 CONFIRMÉ directement adjacent), timing=4 (adopté avr. 2026, PHV certificat = procédure la plus avancée), faisabilite=2 (grands lots existent mais CPTAQ+riverain sévères), marche=3 (premium riverain non quantifiable). scoreGlobal=2.65.",
    },
  ],

  scores: scores3,
  scoreGlobal: weightedScore(scores3),
  recommendation:
    "Surveiller avec prudence — le règlement 150-49-1 est le plus juridiquement avancé (PHV complété) et offre un potentiel de densification réel en H-143 core (50 log/ha). Cependant: la double contrainte GRHQ (512 éléments, Saint-Laurent) + CPTAQ (A-118 directement adjacent, confirmé officiellement) en fait la zone la plus contrainte des trois. Nécessite une expertise géotechnique et CPTAQ préalable avant tout engagement foncier. Lots intérieurs (hors riverain + hors limite A-118) sont les seules positions défendables à court terme.",
});

// ─────────────────────────────────────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────────────────────────────────────

export const valleyfieldDossiers: OpportunityDossierT[] = [
  dossier1,
  dossier2,
  dossier3,
];
