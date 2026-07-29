# BRANCH — fix(lexique): « refonte » lue par occurrence, sur liste positive bornée

**Type** : fix · **Base** : `origin/main` · **Workspace** : radar-immobilier
**ENV** : aucun (vitest direct, aucun stack Docker — la machine héberge
plusieurs stacks + la démo, un stack de trop l'a déjà fait tomber par OOM)

## Problème

`instrument` est la porte de l'axe résidentiel du vivier B′
(`packages/radar-domain/src/vivier/counts.ts`, `isResidentialEligible` :
sans objet résidentiel explicite, seuls `rezonage` et `refonte` restent
éligibles). Toute bascule d'`instrument` fait donc entrer ou sortir un signal
du vivier livré au propriétaire.

Sur `origin/main`, la reconnaissance était :

```ts
if (candidate === "refonte" || text.includes("refonte")) return "refonte";
```

Deux défauts, tenus pour distincts :

1. **Occurrence vs texte entier.** Toute approche par veto (`includes("refonte")`
   moins une liste noire évaluée sur le texte complet — l'approche du commit
   non mergé `44e8b31`) a été jugée BLOQUANTE par deux relecteurs : un
   `DesignationEvent` `category="piia"`, libellé « PIIA — refonte
   architecturale », description « Refonte complète du règlement de zonage »
   voit sa 1ʳᵉ occurrence armer le veto et masquer la 2ᵉ → instrument `piia`
   → le signal SORT du vivier alors qu'il porte une vraie refonte
   réglementaire.
2. **Non-borné.** `includes("refonte")` fait entrer « refonte du site Web
   municipal », « refonte organisationnelle », « refonte des infrastructures »,
   « refonte de la grille tarifaire ».

## Décision

**Liste POSITIVE bornée, évaluée PAR OCCURRENCE** — aucune liste noire, donc
aucun veto capable de masquer une autre occurrence.

- `isRegulatoryReform(text)` itère sur chaque occurrence de `refonte(s)` et
  teste la queue de texte qui la suit contre les seules formes réglementaires
  admises. Une occurrence non réglementaire n'invalide rien : elle ne matche
  simplement pas.
- Trois branches admises : `refonte réglementaire`, `refonte
  <ampleur>` (complète / totale / globale / intégrale / majeure — admise seule
  uniquement en fin de segment ou suivie d'un objet réglementaire, ce qui
  écarte « refonte totale du site Web »), `refonte du|de la|de l'|des <objet>`
  où l'objet ∈ {réglementation, règlement(s), zonage, lotissement,
  urbanisme, plan d'urbanisme}.
- L'adjacence stricte `refonte complete` de l'ancienne `REGULATORY_REFORM_RE`
  ratait « Refonte totale », « refonte du plan d'urbanisme » et « refonte des
  règlements de lotissement » — mesuré, cf. Vérification.

**Ordre des tests** : `refonte` passe AVANT `ppcmoi`/`piia`. C'est ce qui
permet à la refonte réglementaire de porter le signal quand le même PV cite un
PPCMOI (Sutton : « 362 (PPCMOI) » dans la description) ou un PIIA (cas mixte
ci-dessus). Sur `origin/main` `refonte` était testée APRÈS `piia`, ce qui
rendait le cas mixte structurellement inatteignable.

**Apostrophes** : `fold()` retire les diacritiques mais CONSERVE l'apostrophe.
La classe est écrite `['’]` en échappements explicites, vérifiée au
niveau octet (`hexdump -C`), et un test asserte `codePointAt(0)` des deux
apostrophes — un piège déjà payé une fois : une classe annoncée `['’]`
contenait en réalité l'apostrophe ASCII doublée (`5b 27 27 5d`), et
`d'urbanisme` ne matchait jamais.

## Lots

- [x] **LOT 1 — lexique** : `isRegulatoryReform` (liste positive bornée, par
      occurrence) + `refonte` testée avant `ppcmoi`/`piia` dans
      `instrumentFromSignal`.
- [x] **LOT 2 — tests** : 19 cas, dont les 10 rejets hors urbanisme, le cas
      mixte occurrence-vs-texte, Sutton avec PPCMOI cité, et le garde-fou
      octet sur les deux apostrophes.

## Portée

**Allowed** : `api/src/services/graph/vivier-v2.ts`, `api/src/services/graph/vivier-v2.test.ts`,
`plan/BPLEXOCC-BRANCH_*`.
**Forbidden** : `api/src/services/graph/graph-store.ts` (autre agent),
`packages/radar-domain/**`, `ui/**`, `Makefile`, `docker-compose*.yml`,
`rules/**`, `.track/**`, `.github/**`.

## Vérification

- `vitest run src/services/graph/vivier-v2.test.ts` → 27 passed (8 existants + 19 ajoutés).
- `vitest run src/services/graph/` → 212 passed ; les 9 échecs restants sont les
  suites `DB-bound: … (integration)` (`getaddrinfo EAI_AGAIN postgres`), sans
  stack Docker par consigne — elles échouent identiquement sur `origin/main`.
- **Rouge avant / vert après** : les 19 tests rejoués contre le
  `instrumentFromSignal` de `origin/main` → **12 échouent** (les 10 rejets hors
  urbanisme, le cas mixte `piia`, Sutton `ppcmoi`) ; les 6 cas de rappel et le
  test apostrophe passent sur main parce que main est TROP permissif
  (`includes("refonte")` accepte tout) — ce sont des garde-fous de rappel, pas
  des preuves de correction, et ils échouaient sur l'ancienne
  `REGULATORY_REFORM_RE` (3/6 : « Refonte totale », « refonte du plan
  d'urbanisme », « refonte des règlements de lotissement »).

## Reste ouvert (déclaré, non maquillé)

- Normalisation NBSP / tirets typographiques dans `fold()` : hors périmètre,
  non traitée. Un « refonte<NBSP>du règlement » resterait non reconnu.
- `packages/immo-mcp/src/raw-data.ts` : hors périmètre, non touché.
- Le chiffre de recette « 174/327 » et sa reproductibilité : non instruits ici.
- Le titre trompeur du test « byte-identical across API, domain, UI » : non
  corrigé, hors périmètre.
- Aucune mesure sur la base de prod : aucun stack n'a été démarré (consigne
  OOM). L'effet réel sur le vivier livré n'est donc PAS mesuré, seulement
  raisonné à partir du lexique.
