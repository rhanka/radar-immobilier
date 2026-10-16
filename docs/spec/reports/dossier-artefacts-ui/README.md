# Dossier de décision #861 — mes propres vues sur la même API

Enabler P1 : vues UI personnalisées et déploiements de branche servis comme artefacts sur l'API de préproduction, gérés par le MCP Immo enveloppé par cluster-mesh. Carte : [#861](https://github.com/rhanka/radar-immobilier/issues/861).

- Page de lecture : [DOSSIER-DECISION.html](DOSSIER-DECISION.html), page autonome et hors ligne (schémas interactifs, décisions, preuves attendues). Même contenu que la page publiée : https://claude.ai/artifact/5reX9C7TCe1vgvp1LFXn33
- Source : [DOSSIER-DECISION.md](DOSSIER-DECISION.md).
- Décisions de l'owner et leur texte d'origine : [DECISIONS-OWNER.md](DECISIONS-OWNER.md).
- Choix acquis et réglages de préparation : [SUIVI-ARBITRAGES.md](SUIVI-ARBITRAGES.md).
- Réalisation, contrats et recette future : [ANNEXE-TECHNIQUE.md](ANNEXE-TECHNIQUE.md), architecture des schémas : [focus/architecture.md](focus/architecture.md).

## État au 15 octobre 2026 (v12)

Toutes les décisions de l'owner sont intégrées, et aucune question ne reste ouverte :

| Sujet | Décision |
|---|---|
| Hébergement | Cluster-mesh tourne dans Immo et enveloppe le MCP Immo actuel. |
| Continuité | Même adresse MCP, même connexion, mêmes comptes ; outils existants identiques (noms, paramètres, réponses). |
| Données | Usages métier de l'UI, écritures comprises, avec les droits du lecteur. |
| Appel du MCP vers Radar | C : attendre l'échange de jetons de Sentropic. Côté Radar, l'API n'acceptera plus que le jeton échangé, après une bascule soumise au feu vert de l'owner. |

## Construction

La page est construite hors du dépôt, avec la chaîne Focus (Svelte, `node:24-bookworm-slim`, sans réseau), à partir de ces sources Markdown. Les versions antérieures, les avis contradictoires et les pièces de travail restent hors du dépôt.
