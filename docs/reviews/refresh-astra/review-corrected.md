---
status: completed
consensus-verdict: runtime findings fixed; deployment scope disagreements reconciled against owner contract
review-author:
  host: codex
  model: gpt-6-astra
  effort: medium
target-ref: 661b85717944a0aba6eff8ca4b3f108835460a40
legs:
  - path: docs/reviews/refresh-astra/review-runtime-corrected.md
    status: completed
  - path: docs/reviews/refresh-astra/review-deployment-corrected.md
    status: completed
---

# Tour de revue corrective

Nouveau tour explicitement consigné. Le [dossier initial](review.md) conserve les deux refus d’approbation automatique. GitHub a ensuite prouvé que le dépôt était public et les lancements public-diff autorisés. La première [revue runtime publique](review-runtime-public.md) a demandé des changements ; la première jambe [déploiement publique](review-deployment-public.md) a échoué avec HTTP 503. Ces échecs ne sont pas présentés comme revues terminées.

Les deux jambes actuelles ciblent le même commit public, avec identités demandées Claude/gpt-5.6-sol/high et Claude/gpt-5.6-terra/high. Les reçus de lancement n’attestent pas l’identité upstream effective. Le dernier delta local ajoute un test wire Gemini low et corrige le comptage d’un nouvel échec quota sur document primaire repris ; il a son test de régression.

## Rapprochement

- Constats runtime initiaux acceptés : le repli document est restauré depuis les reçus ; identités/statuts retournés sont vérifiés ; délai en course et réponses tardives ne valident ni n’écrasent la sortie de repli. Les tests intégration redémarrage deux fragments et client non coopératif/métadonnées passent.
- Constats runtime correctifs acceptés et corrigés dans `f1d415ea` : refus terminaux identité/statut persistés et restaurés avant appel ; tout résultat non terminé est terminal même sans callback validation. Les tests de reprise couvrent identité divergente et statut texte absent. Le relecteur local indépendant d’état a vérifié ces correctifs.
- Constat déploiement sur circuit durable rejeté au regard de la sémantique de cycle autorisée : le circuit est délibérément par invocation planifiée ; le cycle suivant sonde le primaire rétabli. L’affinité document survit, non la séquence quota.
- Constat déploiement sur attestation nouvelle release hors périmètre autorisé. L’owner a retenu tag + variable GitHub + environnement production, avec acceptation préprod séquentielle par k8s/i-cond. C’est une porte opérationnelle, pas une attestation mécanique revendiquée.

La divergence de la revue déploiement reste visible dans son artefact. Une adjudication locale indépendante a également rejeté les deux P1 comme extensions de périmètre : `backoffLimit: 0` / `restartPolicy: Never` font de la prochaine invocation un nouveau cycle, et l’owner a expressément conservé les contrôles de promotion existants. L’acceptation préprod réelle reste requise avant activation production.
