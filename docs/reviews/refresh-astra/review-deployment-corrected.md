---
status: completed
reviewer-host: claude
reviewer-model: gpt-5.6-terra
reviewer-effort: high
target-ref: 661b8571
lens: durable state/restart, budget, real-model trace, timeout/quality boundaries, and preprod-to-production deployment safety of public committed code
---

# Revue déploiement — jambe code public corrigée

Revue indépendante et bornée du diff public commité [`origin/main...661b8571`](https://github.com/rhanka/radar-immobilier/compare/main...661b8571). Elle ne s’appuie pas sur la jambe Gemini antérieure, échouée avant revue par HTTP 503. Aucun secret, fichier d’environnement, keyring, matériel temporaire, travail non publié, stack active ou test n’a été lu ni utilisé.

## Constats

### P1 — état du circuit quota perdu après redémarrage

La politique documentée ignore Astra après trois replis quota consécutifs au niveau document. La reprise ne restaure pourtant qu’une raison de repli par document et marque ce document compté ; elle ne reconstruit jamais `consecutiveQuotaDocuments` ni `circuitOpen`, initialisés à zéro à chaque politique. Un Job qui enregistre trois replis quota puis est tué peut donc rappeler Astra au document suivant, contraire au circuit quota/budget prévu.

* Preuve : [`restoreDocument` ne restaure que `reason`/`counted`](https://github.com/rhanka/radar-immobilier/blob/661b8571/api/src/services/graph/refresh-model-policy.ts#L49-L74).
* Impact : un redémarrage défait le circuit précisément lors de l’épuisement quota ; résultat dépendant de la durée de vie du Job.
* Correction demandée : persister ou reconstruire déterministiquement la séquence quota ordonnée et le circuit avant le document suivant ; ajouter test après troisième quota.

### P1 — activation production sans porte mécanique sur preuves préprod acceptées

Quand `REFRESH_CRONJOB_PROD_ENABLED` vaut `true`, chaque promotion `v*` déploie et désuspend le CronJob production. Le workflow n’exige ni run primaire préprod réussi, ni repli forcé, ni attestation spécifique release approuvée owner. Les prérequis manuels n’empêchent pas un tag ultérieur d’activer la charge. Cela dépend de mémoire opérateur.

* Preuve : le workflow dépend seulement de `vars.REFRESH_CRONJOB_PROD_ENABLED == 'true'` et l’overlay met `radar-refresh-pv` à `suspend: false`.
* Correction demandée : lier le déploiement à une approbation/attestation protégée par release/digest, ou désarmer automatiquement la variable.

## Contrôles confirmés

Le code conserve les fragments terminés, enregistre les reçus dans l’état durable, réserve deux appels par fragment et impose la course délai. Il rejette identités divergentes et réponses tardives, la politique possède le fichier de sortie, et les refus qualité ne déclenchent pas de repli. La base est dormante, production a un overlay séparé et le workflow épingle le digest API. Ces contrôles ne résolvent pas les deux P1.

## Verdict

**NON PRÊT pour activation production.** Corriger les deux P1 et revoir le diff public résultant avant d’armer la porte production.
