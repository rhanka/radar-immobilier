/**
 * Regression fixture for the "analyse au complet" gap reported by Steve
 * (Saint-Mathieu-de-Beloeil, MRC La Vallée-du-Richelieu).
 *
 * HONESTY (rules/MASTER.md §Fair Benchmarking + ANTI-INVENTION):
 * This fixture is a *SYNTHETIC, STRUCTURE-REALISTIC* reproduction, NOT verbatim
 * public bytes captured from a live source. It is built to reproduce a specific
 * FAILURE PATTERN the current parser exhibits — it is not presented as, and must
 * never be cited as, real captured data. The wording mirrors the standard Québec
 * PV layout (numbered agenda points "5.1", "5.9", resolution ids, an appended
 * "ANNEXE L" grille des usages) so the segmenter is exercised against a realistic
 * shape, but every byte here is authored for the test, not scraped.
 *
 * THE BUG IT REPRODUCES (reported by Steve):
 *   The real residential-densification signal was NOT under the first detected
 *   point. It lived under a SECONDARY point (5.9) and in ANNEXE L. The existing
 *   `detectZonageChange` detector only fires on an "avis de motion → règlement de
 *   zonage" chain, so:
 *     - it surfaces the FIRST "avis de motion" it meets (here point 6.1, a water
 *       tariff bylaw — no habitation content at all), and
 *     - it never reports the genuine opportunity at point 5.9 (a PPCMOI
 *       authorising a 24-logement multifamily building) nor ANNEXE L (the grille
 *       des usages spelling out the density), because neither carries the
 *       "avis de motion" trigger phrase.
 *
 * WHAT THE NEW SCANNER MUST DO:
 *   `scanHabitationSignals` walks the WHOLE document (every numbered point + every
 *   annexe) and returns a LIST of habitation/densification segments, each tagged
 *   with its point/annexe locator and a verbatim citation — so point 5.9 and
 *   ANNEXE L are both surfaced instead of being lost behind point 6.1.
 */

/**
 * Synthetic PV text for Saint-Mathieu-de-Beloeil, séance ordinaire du 7 juillet 2026.
 * Numbered agenda points + an appended ANNEXE L (grille des usages).
 *
 * Key layout:
 *   - Points 1–4: procedural / finance (no habitation content).
 *   - Point 5.1: dérogation mineure (a marge latérale — densification-adjacent
 *     but not the headline signal).
 *   - Point 5.9: the REAL signal — a PPCMOI authorising a 24-logement
 *     multifamily building, cross-referencing ANNEXE L. No "avis de motion".
 *   - Point 6.1: an "avis de motion" for a WATER TARIFF bylaw (2026-45) — the
 *     decoy the old detector surfaces first. No habitation content.
 *   - ANNEXE L: the grille des usages for zone H-04 (habitation multifamiliale,
 *     up to 24 logements, density figure).
 */
export const PV_SAINT_MATHIEU_2026_07_TEXT = `PROVINCE DE QUÉBEC
MUNICIPALITÉ DE SAINT-MATHIEU-DE-BELOEIL
MRC DE LA VALLÉE-DU-RICHELIEU

Procès-verbal de la séance ordinaire du conseil municipal tenue le 7 juillet 2026.

1. OUVERTURE DE LA SÉANCE
La séance est ouverte à 20 h par le maire.

2. ADOPTION DE L'ORDRE DU JOUR
Il est résolu d'adopter l'ordre du jour tel que présenté.

3. ADOPTION DU PROCÈS-VERBAL
Il est résolu d'adopter le procès-verbal de la séance ordinaire du 2 juin 2026.

4. TRÉSORERIE
4.1 Approbation des comptes à payer
Il est résolu d'approuver la liste des comptes à payer au montant de 512 340,18 $.

5. URBANISME ET AMÉNAGEMENT DU TERRITOIRE

5.1 Dérogation mineure DM-2026-014 — 123, rue Principale
2026-07-131
CONSIDÉRANT une demande de dérogation mineure visant à réduire la marge latérale
à 1,2 mètre pour la construction d'un garage détaché;
Il est résolu d'accorder la dérogation mineure DM-2026-014 telle que demandée.

5.9 Résolution — projet particulier de construction, de modification ou
d'occupation d'un immeuble (PPCMOI) — 500, boulevard Sir-Wilfrid-Laurier
2026-07-139
CONSIDÉRANT que la demande vise à autoriser un projet d'habitation multifamiliale
sur le lot 4 210 555 du cadastre du Québec;
CONSIDÉRANT que le projet consiste en la construction d'un immeuble résidentiel de
24 logements répartis sur quatre étages, avec une densité brute de 120 logements à
l'hectare, ce qui déroge à la grille des usages en vigueur;
CONSIDÉRANT que les usages et normes applicables au projet sont détaillés à la
grille des usages jointe en annexe L au présent règlement;
Il est résolu d'autoriser le projet particulier (PPCMOI) tel que soumis, selon la
grille des usages reproduite à l'annexe L.

6. RÉGLEMENTATION

6.1 Avis de motion — Règlement 2026-45 sur la tarification de l'eau potable
2026-07-141
Monsieur le conseiller Jean Tremblay donne un avis de motion qu'un règlement numéro
2026-45 décrétant la tarification de l'eau potable sera déposé, pour adoption, à une
séance ultérieure.

7. LEVÉE DE LA SÉANCE
Il est résolu de lever la séance à 21 h 15.

ANNEXE L
Grille des usages et des normes — zone H-04

Groupe d'usage : Habitation multifamiliale (h4)
Nombre maximal de logements par bâtiment : 24
Densité brute maximale : 120 logements à l'hectare
Hauteur maximale : 4 étages
Cette grille des usages autorise expressément le logement multifamilial et la
densification résidentielle dans la zone H-04.
`;
