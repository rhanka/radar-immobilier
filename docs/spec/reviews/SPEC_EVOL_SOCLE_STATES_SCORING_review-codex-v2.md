# Relecture de confirmation — SPEC_EVOL_SOCLE_STATES_SCORING v2

## 1. Doctrine de disponibilite (§3.4.0)

La contradiction v1 est globalement levee. La v2 pose une regle testable: un axe est `available` si une preuve place un niveau au grain mesure par cet axe; sinon il est `non-disponible` (`docs/spec/SPEC_EVOL_SOCLE_STATES_SCORING.md:268-273`). La distinction risque/marche est defensable: le risque a des faits au grain zone/bbox (BDZI/GRHQ) et une sous-piece CPTAQ hypothetique (`:275-281`), tandis que le marche n'a que des donnees regionales MRC/CMHC, explicitement insuffisantes pour placer un niveau zone (`:261-266`).

Ce n'est pas un sophisme post-hoc si l'implementation respecte strictement cette frontiere. La v2 assume aussi que la renormalisation impute la moyenne (`:285-287`) et que l'honnetete vient du flag `partial` + cap (`:386-388`). Point confirme.

## 2. Entite `Signal` + `signalId`

Le bloquant v1 est leve sur le fond. Le shape minimal `Signal` existe (`id`, `type`, `value`, `confidence`, `status`, `sourceRefs`, `detectedAt`, `bylaw`, `zone`) et le dossier gagne `signalId` (`docs/spec/SPEC_EVOL_SOCLE_STATES_SCORING.md:48-67`). Pour ÉV2 Radar T1, c'est suffisant pour trier, afficher un signal, relier les sources et obtenir le fan-out 1→N par requete sur les dossiers.

Nettoyage a prevoir: formaliser `SignalType` dans la migration/schema, pas seulement en commentaire (`:54-57`, `:402`). Je ne vois pas de migration lourde inevitable pour ÉV2.

## 3. Mode reel/simulation

Le journal reel est mieux protege: `JournalEntry.mode` est present (`docs/spec/SPEC_EVOL_SOCLE_STATES_SCORING.md:120-128`), `OpportunityDossier` et `JournalEntry` portent `mode` (`:155-160`), et l'AC demande une requete real-mode qui exclut les decisions de simulation (`:426-427`). Pour le cas strict "decision simulee qui pollue le journal reel", c'est resolu.

Il reste un trou de contrat: `Signal` n'a pas de `mode`, et les exports reels sont seulement decrits comme excluant les "simulation rows" (`:159-160`) alors que des preuves simulees peuvent etre embarquees comme donnees (`Verification += simulé`, `:150-153`). Si ÉV3 permet de simuler un signal T1 ou d'ajouter des preuves simulees dans un dossier reel, le filtre real-mode n'est pas complet. Il faut soit ajouter `mode` a `Signal`, soit ecrire explicitement que les signaux simules sont impossibles et que les exports reels filtrent aussi les preuves `verification: "simulé"`.

## 4. Robustesse `aggregate()`

Les corrections v1 principales sont bien la: invariant `available ⇔ level !== null` (`docs/spec/SPEC_EVOL_SOCLE_STATES_SCORING.md:315-320`), garde `wSum`/plancher 0.50 avec chemin `tooThin` (`:313-327`), et plus de division 0/0 dans le cas "tout non-disponible".

Mais le pseudo-code n'est pas encore robuste. Il ne valide pas:

- `level` fini et dans `[0,5]`;
- poids fini, positif, non manquant;
- somme/configuration des poids conforme aux axes attendus;
- absence d'axe inconnu ou d'axe requis absent.

Le cast `weights[k as Axis]` (`:322`, `:328`) masque ce probleme: un axe inconnu ou un poids manquant donne `undefined`, donc `wSum = NaN`; `NaN < WEIGHT_FLOOR` est faux, et la fonction peut retourner un score `NaN` avec `tooThin: false`. Des poids negatifs peuvent aussi produire un score hors domaine. C'est un vrai residuel du bloquant "robustesse", pas un detail de style. Il faut un schema/parse runtime et des tests AC pour ces cas.

## 5. Regression v2

Pas de regression majeure sur les points surveilles:

- cap parent: la v2 assume la supersession `surveillance` → `qualifier-avec-expert` et la documente (`docs/spec/SPEC_EVOL_SOCLE_STATES_SCORING.md:292-304`);
- `simulé`: corrige l'ancien mensonge, ajoute bien la 4e valeur et la migration (`:150-153`, `:404`);
- grille marche: les niveaux 0-5 sont maintenant complets (`:251-259`);
- renormalisation: l'imputation par moyenne est explicitement assumee (`:173-178`, `:285-287`, `:386-388`).

Nouvelle incoherence mineure: le scope annonce "six T2 grids" (`docs/spec/SPEC_EVOL_SOCLE_STATES_SCORING.md:22-24`) alors que le modele et les poids n'ont que cinq axes (`:195`, `packages/radar-domain/src/schemas/opportunity.ts:55-61`). A corriger, mais non bloquant.

## 6. Recalcul

Les chiffres de §5 tombent.

- H-609-4: `(4*0.30 + 3*0.20 + 3*0.20 + 2*0.15) / 0.85 = 3.17647`, donc **3.18**. Le naif avec marche=3 vaut **3.15**. Les niveaux actuels sont bien 4/3/3/2/3 (`packages/radar-domain/src/valleyfield-dossiers.ts:34-67`) et `scoreGlobal` utilise le score pondere courant (`:292-293`).
- U-521→H-521: `(4*0.30 + 2*0.20 + 4*0.20 + 3*0.15) / 0.85 = 3.35294`, donc **3.35**. Le naif vaut **3.30**. Niveaux 4/2/4/3/3 (`packages/radar-domain/src/valleyfield-dossiers.ts:310-343`), `scoreGlobal` courant (`:568-569`).
- H-143/H-143-1: `(3*0.30 + 1*0.20 + 4*0.20 + 2*0.15) / 0.85 = 2.58823`, donc **2.59**. Le naif vaut **2.65**. Niveaux 3/1/4/2/3 (`packages/radar-domain/src/valleyfield-dossiers.ts:586-620`), `scoreGlobal` courant (`:834-835`).

Le calcul naif est confirme par `weightedScore` et les poids PROCESS (`packages/radar-domain/src/schemas/opportunity.ts:89-103`). Arithmetique: RAS.

## 7. Bloquants residuels avant writing-plans/implementation

Vrai bloquant:

1. `aggregate()` doit valider runtime les axes, niveaux et poids avant de pouvoir etre appele "robuste". Ajouter a la spec/AC: niveau hors `[0,5]` rejete, poids manquant/negatif/NaN rejete, axe inconnu rejete, axe requis absent rejete, et tests associes.

Quasi-bloquant a clarifier avant ÉV2/ÉV3:

2. Le cloisonnement simulation doit couvrir `Signal` et les exports de preuves `simulé`, ou la spec doit interdire explicitement les signaux/preuves simules dans le flux reel. Le journal est protege; le systeme complet ne l'est pas encore assez clairement.

Nettoyages:

- corriger "six T2 grids" → cinq axes;
- rendre explicite la mise a jour du parent sur le cap;
- transformer `SignalType` en enum schema/migration;
- garder le cap weight-blind comme limite V1 assumee.

## Verdict final: **NO-GO**

La v2 leve trois des quatre bloquants v1 et corrige correctement l'arithmetique. Le NO-GO reste court et ciblé: `aggregate()` n'est pas encore specifie comme une frontiere robuste face aux entrees invalides, et le cloisonnement simulation doit etre etendu ou explicitement borne pour `Signal`/exports. Une revision de spec petite, avec AC de validation, devrait suffire pour passer GO.
