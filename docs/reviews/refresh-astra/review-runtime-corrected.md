---
status: completed
declared-identity: claude/gpt-5.6-sol/high
requested-identity: claude/gpt-5.6-sol/high
reviewer-host: claude
reviewer-model: gpt-5.6-sol
reviewer-effort: high
target-ref: 661b8571
lens: corrected runtime fallback — durable document affinity, result identity/status, enforced deadline, and selected output ownership
scope: public committed diff origin/main...661b8571
---

# Revue runtime corrigée

Cette revue bornée n’a utilisé que le code public commité dans `origin/main...661b8571`. Aucun test ni stack n’a été exécuté, conformément à la demande.

## Constats

### [Élevé] Un échec terminal d’intégrité de résultat devient un repli permis après redémarrage

Le chemin immédiat traite correctement une identité fournisseur/modèle divergente et un échec après validation réussie comme terminaux : `attempt()` positionne `terminalFailure`, persiste un reçu échoué, et le primaire lève sans appeler Gemini (`api/src/services/graph/refresh-model-policy.ts:111-120,129-147`). Le chemin de restauration durable ne conserve pas cette classification. `restoreDocument()` prend le premier `fallbackReason`, sinon **n’importe quel** `failureReason` de reçu échoué, et le transforme en raison persistante de repli (`api/src/services/graph/refresh-model-policy.ts:60-63`).

Cela crée un contournement à la reprise : Astra retourne une identité incorrecte, le processus s’arrête avant terminaison du fragment, puis le cycle suivant hydrate le reçu et appelle Gemini directement. Le même problème concerne un résultat non terminé ayant fourni un texte validé. Persister une classification explicite terminale/sans-repli (ou ne restaurer que les reçus prouvant qu’un repli fut sélectionné), et couvrir la reprise avec identité divergente et statut non terminé.

### [Moyen] Un résultat résolu non terminé est admissible au repli transport sans callback validateur

Le contrôle statut lève `REFRESH_EMPTY_OUTPUT` pour tout résultat non `completed` (`api/src/services/graph/refresh-model-policy.ts:115-116`). Il n’est terminal que si `responseValidated` vaut true ; sinon `empty-output` devient raison choisie et Gemini est appelé. Un client peut retourner légitimement `instructions_written` sans fournir de texte à `validateResponse`. C’est un statut runtime résolu, pas un flux modèle réussi vide ; la politique transport-only doit le refuser. Ajouter le cas sans callback et rendre tout statut résolu non terminé terminal.

## Corrections vérifiées

- Les reçus durables sont hydratés avant traitement et le test intégration multi-fragments exerce l’affinité de repli après recréation de politique.
- Fournisseur/modèle et statut `completed` retournés sont contrôlés avant succès ; une identité divergente est enregistrée avec `modelUsed: null`.
- `Promise.race` applique l’échéance même si le transport ignore abort ; le validateur contrôle le signal et une validation tardive est rejetée.
- Le client ne reçoit plus `outputPath` ; seule la politique écrit le texte validé, donc un primaire tardif ne peut écraser Gemini.
- Persistance reçu/sortie choisie demeure hors catch de repli transport ; les échecs stockage ne déclenchent pas un autre appel modèle.

## Verdict

**CHANGEMENTS DEMANDÉS.** Les constats initiaux sont substantiellement corrigés dans le chemin normal, mais les échecs terminaux identité/statut ne sont pas durables et peuvent devenir admissibles au repli après redémarrage. Les résultats résolus non terminés restent également admissibles sans validation.
