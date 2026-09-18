---
status: incomplete
observed-failure: automatic approval rejected both external review launches
review-author:
  host: codex
  model: gpt-6-astra
  effort: medium
target-ref: 7bf2d17f5f30236879cd6eb91353ae253a28c866
---

# Revue indépendante

Jambes déclarées/demandées : hôte Claude avec `gpt-5.6-sol` high (exactitude runtime) et hôte Claude avec `gemini-3.8-flash` high (déploiement, persistance, sémantique d’échec). Elles diffèrent de l’hôte/modèle auteur. Les IDs ont été contrôlés dans le catalogue mesh 0.19.2 installé le 2026-09-17. Les reçus de lancement attestent l’identité demandée, non le routage upstream effectif.

Les revues de conception ont identifié, et l’implémentation traite, le comptage document/fragment, les signaux de délai séparés, le budget de repli réservé, l’identité de politique forcée, la suppression des retries qualité et les reçus de modèle durables par fragment.

Artefacts : [runtime](review-runtime.md), [déploiement](review-deployment.md).

Les deux lancements MCP ont été refusés avant démarrage : l’approbation automatique a classé l’export de diff de dépôt privé vers ces destinations externes comme non autorisé. Une autorisation owner a été demandée ; aucun verdict de consensus n’est avancé.
