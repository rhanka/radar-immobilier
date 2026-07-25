# BRANCH — fix(vivier-b): the `r` axis keeps unstated rezonings

**Type** : fix · **Base** : `origin/main` · **Workspace** : radar-immobilier
**ENV** : `test-bpcs`

## Problème

En prod, cocher « résidentiel » vidait le vivier des refontes : les trois villes
notées 10/10 par Steve (Saint-Stanislas-de-Kostka, Sutton, Saint-Raphaël)
tombaient à 0. Mesuré sur la base de prod : leur signal de refonte porte
`zonage=oui`, `résidentiel=indéterminé`, aucune exclusion — l'axe `r` n'acceptait
que `oui`, donc il les éjectait.

C'est la règle R2 du contrat qui était violée : « refonte détectée = RANG, JAMAIS
porte » (`SPEC_EVOL_FILTRAGE_VIVIER_v2` §37).

## Décision

`indéterminé` recouvrait deux états différents :
- **non précisé** — un rezonage/refonte redessine la grille de zonage, il PEUT
  donc être résidentiel ;
- **vraie inconnue** — le PV ne permet pas de trancher (dérogation mineure, PIIA…).

L'axe `r` coché garde désormais le résidentiel **éligible** = `oui` ∪ rezonage /
refonte non précisé, et n'exclut que le **non-résidentiel explicite**.

Mesure sur les 3 294 signaux réels de prod (base B = 1 553) :

| Règle | Signaux avec `r` coché |
|---|---|
| Avant (`oui` seul) | 393 |
| **Retenue** (`oui` ∪ rezonage non précisé) | **753** |
| Rejetée (tout `indéterminé`) | 1 553 = la base entière → `r` ne filtrerait plus rien |

La règle large aurait fait entrer 175 dérogations mineures, 129 PIIA et 100
dérogations — dont, à Saint-Stanislas, une remise, une écurie et des panneaux
solaires.

## Lots

- [x] **LOT 1 — prédicat partagé** : `isResidentialEligible` dans
      `packages/radar-domain/src/vivier/counts.ts`, source unique consommée par
      les compteurs serveur ET la projection client (le rail et le panneau ne
      peuvent pas diverger).
- [x] **LOT 2 — compteurs** : `stageCountsResOui` → `stageCountsResEligible`
      (+ pendant hors-zonage). Renommage plutôt qu'ajout : l'ancien nom aurait
      menti sur son contenu, et aucun champ mort n'est laissé derrière.
- [x] **LOT 3 — projection** : `projectComposedVivierB` lit le prédicat partagé.
- [x] **LOT 4 — tests** : cas discriminant ajouté (un indéterminé NON-rezonage
      reste filtré) pour empêcher tout retour à « `r` ne filtre rien ».

## Portée

**Allowed** : `packages/radar-domain/src/vivier/**`, `ui/src/lib/signals/vivier-view-mode*`,
`ui/src/lib/components/maps/SignauxRail*.test.ts`, `api/src/routes/graph-signals.test.ts`,
`plan/BPCS-BRANCH_*`.
**Forbidden** : `Makefile`, `docker-compose*.yml`, `rules/**`, chemins d'un autre lot.

## Vérification

- `make test-api ENV=test-bpcs` — 95 fichiers, 1 421 passed, 9 skipped
- `make test-ui ENV=test-bpcs` — 90 fichiers, 1 242 passed, 10 todo
- `make typecheck ENV=test-bpcs` — exit 0 (7 warnings CSS préexistants)
- `make lint ENV=test-bpcs` — exit 0
- `git diff --check origin/main...HEAD` — clean
- Mesure sur données de prod : les 3 villes 10/10 passent de 0 à 1 signal avec
  `r` coché.

## Reste ouvert (déclaré, non maquillé)

- La recette cible **✓2** par ville 10/10 ; la règle en remonte **1**. L'écart
  n'est pas comblé et aucun 2ᵉ signal n'est fabriqué pour y parvenir.
- Les dérogations mineures ressortent avec `zonage=oui` (une remise, des
  panneaux solaires) — suspicion de faux positif dans `isZonageSignal`, à
  instruire séparément.
- Rosemère / Saint-Charles-Borromée restent `indéterminé` : leur exclusion ✗0
  dépend d'un marquage sémantique geo (pôle régional/commercial) qui n'existe
  pas encore. Rien n'est inventé pour forcer la cible.
