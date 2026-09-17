---
status: completed
declared-identity: claude/gpt-5.6-sol/high
requested-identity: claude/gpt-5.6-sol/high
reviewer-host: claude
reviewer-model: gpt-5.6-sol
reviewer-effort: high
target-ref: 5f26f219
lens: runtime correctness — transport-only fallback, quality no retry, timeout, per-document circuit, real model receipts
scope: public committed diff origin/main...5f26f219
---

# Revue runtime

La visibilité publique du dépôt a été vérifiée (`isPrivate=false`) et le commit cible est présent sur `origin/feat/refresh-prod-astra-low`. Cette revue n’a utilisé que le contenu public commité à `5f26f219` et son diff depuis `origin/main`.

## Constats

### [Élevé] L’affinité de repli document est perdue lors d’une reprise durable

`createRefreshModelPolicy` conserve la raison de repli choisie seulement dans la map locale `documents`. Bien que chaque tentative soit persistée dans `state.documentModels`, un nouveau processus planifié crée une politique neuve sans hydrater cette map. Pour un PDF multi-fragments, un quota Astra sur le premier fragment suivi de Gemini, puis une fin de Job, fait rappeler Astra au cycle suivant pour le fragment restant. Persister/restaurer l’état de repli document avant le premier fragment incomplet et ajouter un test de reprise à deux fragments.

### [Élevé] Les reçus rapportent l’identité demandée et une complétion inférée, pas le résultat réel

Après `generateJson`, la politique enregistre `modelUsed` depuis la configuration et assigne inconditionnellement `completed` sans inspecter fournisseur, modèle ou statut de la génération retournée. Le profil aval contrôle pourtant `generation.status === "completed"`. Construire le reçu avec les métadonnées retournées, exiger la route exacte et conserver le statut retourné, avec tests identité divergente et résultat non terminé.

### [Moyen] Le délai par tentative est coopératif plutôt qu’imposé

Le timer annule un `AbortController`, mais le code attend directement `generateJson`. Si client/adaptateur/validation ne se résout pas après abort, la tentative peut attendre Kubernetes ; une résolution tardive peut être enregistrée `completed`. Imposer l’échéance à la frontière politique, rejeter le succès tardif et gérer le rejet tardif ; ajouter tests client non coopératif et résolution tardive.

## Observations positives

- Les tentatives mesh sont limitées à une et les substitutions de modèle équivalent désactivées.
- Les exceptions validation/provenance sont classées `quality-refused` sans repli.
- Primaire et repli ont des contrôleurs séparés.
- Les reçus sont persistés avant le log sûr, sans messages fournisseur ni corps de réponse.
- Le circuit quota est document-clé dans un processus et s’ouvre après trois documents quota ; un document primaire entièrement réussi le réinitialise.

## Verdict

**CHANGEMENTS DEMANDÉS.** La séparation transport-only/qualité est directionnellement correcte, mais affinité durable, reçus issus du résultat réel et échéance imposée ne sont pas satisfaites à `5f26f219`.
