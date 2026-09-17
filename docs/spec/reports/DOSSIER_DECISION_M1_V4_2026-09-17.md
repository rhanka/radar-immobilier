# Dossier de décision M1 v4 — refresh municipal

## Décision

Déployer **astra-low** en production sous les gates existants. Le bras a traité et fait accepter 100/100 documents et son F1 macro Oracle v2 est 0,584. Il est associé à la PR #714 et prouvé en préproduction sur six villes. Le repli opérationnel est **gemini-low** : 85/100 acceptés, F1 0,518 sur les acceptés, F1 × acceptation 0,441.

## Pourquoi ce choix

La métrique de décision est F1 macro × acceptation, pour ne pas classer au-dessus un modèle précis sur le sous-ensemble qu'il a réussi à produire. astra-low atteint 0,584; sol-medium 0,525; opus5-off 0,470. Les bras sans oracle complet ne sont pas artificiellement classés.

## Options écartées

- **sol-medium** : bonne qualité pondérée, mais 94/100 acceptés et $0,2685/doc API.
- **opus5-off** : F1 sur acceptés élevé (0,690) mais seulement 68/100 acceptés et $0,6507/doc.
- **gemini-low comme primaire** : coût API faible ($0,0376/doc) et siège AI Pro mesuré, mais qualité pondérée moindre.
- **siège comme mécanisme de production** : pas de capacité garantie pour Codex; Claude Max est N-A (OAuth CLI indisponible sans variables API). Un siège n'est pas un SLA de pipeline.

## Coût, bascule et garde-fous

astra-low API coûte $0,4072/doc. Son coût siège est conditionnel du palier ChatGPT et du quota observé; le seuil strict publié est 492 docs/mois au palier Pro 20x. gemini-low AI Pro est mesuré à environ $0,0014/doc au volume observé; seuil API/siège : 532 docs/mois. Ces seuils sont des indicateurs économiques, pas une permission de contourner les gates, quotas ou limites fournisseur.

Conserver les reçus immuables, validation v9, surveillance des refus profil/provenance et repli automatique document par document vers gemini-low quand astra-low est indisponible. Les code 23 Codex restent une classe backend définitive distincte.

## Questions ouvertes avant extension

1. Le CronJob production ne couvre actuellement que Waterloo : quelle stratégie et quelle preuve de déploiement multi-ville ?
2. Quelle preuve mesurée de **signaux neufs** (et non seulement relecture d'un corpus historique) faut-il produire par ville avant généralisation ?
3. Quel volume réel par cycle rend le seuil siège pertinent, avec quel palier effectivement détenu ?

## Traçabilité

Voir `docs/reports/benchmark-v101b-2026-09-17.md`, les reçus v101b et la calculatrice de coûts dans le worktree benchmark. La scène Focus jointe résume le flux et les gates de décision.
