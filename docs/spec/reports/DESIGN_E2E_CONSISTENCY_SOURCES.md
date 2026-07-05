# Design réconcilié — Indicateurs de cohérence E2E par ville (vue Sources)

> **Double consensus** : volet OPUS 4.8 (`..._opus.md`) + volet CODEX 5.5
> (`..._codex.md`), réconciliés ici. À **valider par le principal AVANT
> implémentation**.

## Consensus (les DEUX volets convergent — haute confiance)

1. **Cohérence = lane SÉPARÉE de la couverture** (API, UI, couleur, copy, tri
   distincts). Une ville peut être « tout servi » en couverture ET incohérente :
   geo sert le zonage *live* mais le mapper PG ne l'a pas pullé ; ou un signal
   cite une zone *proposée* absente du zonage courant. **Peindre vert = fausse
   promesse produit.** Deux badges, jamais un seul.

2. **5 arêtes** de la chaîne PV → signal → zone → grille → lot (+ TOD enrichissement) :
   - **E0 PV↔signal** (grounding) · **E1 signal↔zone** (rappel + précision) ·
     **E2 zone↔grille** (rappel — **normes parsées** strictes ; lien-grille seul =
     partiel) · **E3 zone↔lot** (rappel) · **E4 signal↔lot** (secondaire).

3. **Score = MAILLON FAIBLE (bottleneck), PAS une moyenne.** Tri-état
   **`Cohérent` / `À qualifier` / `Non mesuré`** (JAMAIS « Non couvert » = c'est
   la couverture). Une ville PV✓/signaux✓/lots✓ mais sans mapping signal↔zone
   n'est pas « 75 % », elle est **bloquée à l'arête zone**. Un `sort_score`
   pondéré (signalZone 0,35 le plus fort, car c'est le vrai goulot ~59 %) sert
   **uniquement au tri**, jamais affiché en %.

4. **Dénominateurs EXPLICITES** (30 / 1104 / 1106 / 33 / 5000+ jamais mélangés).
   Chaque affichage = `num/dénom` + scope. Dénom vide → `non_applicable` ou
   `non_mesuré`, **JAMAIS 100 %** (une ville sans signal désignant une zone n'est
   pas « 100 % cohérente »).

5. **Province = snapshot BATCH** (matérialisé, immuable, daté `freshness`) — pas
   1104 requêtes OGC à chaque chargement de Sources. **Ville sélectionnée = live
   preview** (étiqueté « aperçu ville », ne met jamais à jour les totaux
   province). Le mapper (signal↔zone) est **PG/batch**, pas live.

6. **Précision = formelle (DB-exists) par défaut** ; la vraie précision exige un
   **échantillon audité**. Ne jamais afficher « précision » comme claim global.
   Faux positifs mapper connus : n° de règlement lu comme code zone (`Z-94`),
   mauvaise couche geo (affectation/plan), zone proposée non courante, famille vs
   sous-zone (`H1` vs `H1-30`), fallback ville sur code commun. → **afficher le
   rappel par défaut, réserver la précision aux audits échantillonnés.**

## Métriques par arête (num / dénom — du volet codex, précis)

| Arête | Métrique | Numérateur / Dénominateur | Mode |
|---|---|---|---|
| E0 PV→signal | grounding | signaux groundés (ref doc + citation) / signaux publiés | **live** (déjà `signals.withCitation`) |
| E1 signal→zone | rappel | designations-zone matchées (zone servie + géométrie) / designations-zone | **batch PG** (mapper #74) |
| E2 zone→grille | rappel | zones avec **normes parsées** / zones-signal servies (lien-grille = crédit partiel) | live-preview / batch |
| E3 zone→lot | rappel | zones-signal avec ≥1 lot joint / zones-signal servies (+ métrique ville : lots joints/servis, join `code` vs `centroïde` distingués) | live-preview / batch |
| E4 signal→lot | rappel (secondaire) | refs-lot matchées / refs-lot | batch PG |

Applicabilité (anti-100%-trompeur) : toujours reporter `signaux désignant une
zone / signaux publiés` — une ville sans designation zone est « non applicable »,
pas « cohérente ».

## Seuils « Cohérent » (codex — volontairement stricts)
`pvSignal ≥ 0,95` (prioritaires **100 %** pour la preuve E2E client) ·
`signalZone ≥ 0,85` · `zoneGrid ≥ 0,80` (normes parsées, pas juste lien) ·
`zoneLot ≥ 0,95`. Le mapper actuel (~59 %) doit apparaître **« À qualifier »**,
pas « pass ».

## UI
- **Scorecard** : section **« Cohérence E2E »** SOUS la couverture (2e badge, pas
  remplacement) + 4-5 lignes d'arêtes en `num/dénom` + **ligne bloqueur** + sous-
  ligne `batch PG · date`. Le badge couverture « Servi/Partiel/Non couvert » reste.
- **Console** : colonnes `Cohérence · PV · S-Z · Z-G · Z-L · Bloqueur` + contrôle
  « Trier par cohérence » (trouver les villes couvertes mais mappings rompus).
- **Carte** : onglet segmenté **Couverture / Cohérence** ; en mode Cohérence,
  couleur par ÉTAT (pas par % continu), « Non mesuré » neutre si pas de snapshot.
- **Labels bloqueur neutres** : Aucun signal publié · Signal sans citation ·
  Aucune zone désignée · Zone désignée non servie · PG non pullé · Grille absente ·
  Lots non joints · Précision non auditée. (« bug » seulement si défaut applicatif prouvé.)

## Ordre d'implémentation (codex — aligné roadmap 30→33→1104→5000+)
1. **Contrat snapshot batch + E0/E1 depuis PG** (valeur immédiate, aligné mapper #74).
2. **Pull focus-30 zonage/lots dans PG** (sinon live≠PG en boucle).
3. **Live-preview E2/E3** (ville sélectionnée, code OGC existant, étiqueté aperçu).
4. **Batch E2/E3** pour focus-30 puis cohorte 33.
5. **Province 1104 en DERNIER** (une fois dénominateurs + échantillons audit stables).

## Divergences opus↔codex
**Aucune matérielle.** Les deux convergent sur : lane séparée, 5 arêtes,
maillon-faible (pas moyenne), dénominateurs explicites, batch-vs-live, précision-
non-auditée. Codex apporte la profondeur opérationnelle (units exacts, contrat API
`city.consistency`, snapshot immuable, seuils, ordre) ; opus apporte la structure +
l'alignement axes + l'exemple Mont-Tremblant. Réconciliés ci-dessus.

## À valider par le principal (avant implémentation)
- (a) Les **5 arêtes** + **normes parsées** (pas juste lien-grille) comme métrique stricte E2 ?
- (b) Le **score = maillon faible tri-état** (pas de % headline) ?
- (c) L'**ordre** (E0/E1 PG batch d'abord, focus-30, province en dernier) ?
- (d) Faut-il **pull focus-30 dans PG** en prérequis (étape 2) — ou vit-on avec live-preview d'abord ?
