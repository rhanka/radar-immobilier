# Benchmark T1 v6 — contrat de citations compact

## Résultat

Le contrôle Valcourt a franchi tout le chemin produit avec le contrat
`immo-pv-extraction-v5` et le plafond commun de 16 384 tokens : HTTP 200,
7 747 tokens de sortie, JSON complet après retrait du fence, profil et
provenance valides. Les 19 citations compactes ont toutes reçu les cinq
champs constants de l'identité PDF avant validation.

La campagne a été arrêtée après son deuxième PDF. Lac-des-Seize-Îles est
accepté; Saint-Étienne-de-Bolton a clos son dernier événement SSE avec
`MAX_TOKENS` à 15 057 tokens visibles et un JSON incomplet. Conformément au
garde de campagne, Valcourt, Saint-Barthélemy et Waterloo n'ont pas été
relancés dans la campagne. Quatre requêtes Gemini sur le plafond de huit ont
été consommées au total : sonde de plafond, contrôle v5 et deux PDF de
campagne.

Sonnet est `N-A` : la clé Anthropic est absente de l'environnement du
processus, sans lecture de fichier `.env*`. Les deux juges prévus sont `N-A` :
`h2a_run` a refusé le worktree benchmark hors de sa racine de démarrage MCP;
aucun contournement n'a été tenté.

## Tableau PDF × modèle

| PDF | Modèle | HTTP | Latence | Tokens entrée/sortie/total | Fin SSE | Profil | Provenance | Accepté | Score déterministe |
| --- | --- | ---: | ---: | ---: | --- | --- | --- | --- | --- |
| Lac-des-Seize-Îles | Gemini 3.8 Flash LOW | 200 | 20 945 ms | 6 811 / 7 567 / 14 378 | STOP | oui | oui | oui | P=1,00; R=0,25; F1=0,40 |
| Lac-des-Seize-Îles | Sonnet comparable | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A |
| Saint-Étienne-de-Bolton | Gemini 3.8 Flash LOW | 200 | 54 670 ms | 19 346 / 15 057 / 34 403 | MAX_TOKENS | N-A | N-A | non | N-A |
| Saint-Étienne-de-Bolton | Sonnet comparable | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A |
| Valcourt | Gemini 3.8 Flash LOW | N-A, arrêt | N-A | N-A | N-A | N-A | N-A | N-A | N-A |
| Valcourt | Sonnet comparable | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A |
| Saint-Barthélemy | Gemini 3.8 Flash LOW | N-A, arrêt | N-A | N-A | N-A | N-A | N-A | N-A | N-A |
| Saint-Barthélemy | Sonnet comparable | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A |
| Waterloo | Gemini 3.8 Flash LOW | N-A, arrêt | N-A | N-A | N-A | N-A | N-A | N-A | N-A |
| Waterloo | Sonnet comparable | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A |

Le cas Lac-des-Seize-Îles contient 24/24 citations avec identité exacte, page
physique valide et extrait textuellement retrouvé. Il couvre 1 des 4 unités
de l'oracle gelé. Le jugement sémantique indépendant reste `N-A`.

## M1 recommandée avec réserves

Recommander `gemini-3.8-flash-tiered` en effort LOW comme seul candidat M1
mesuré, mais ne pas le promouvoir. Les réserves sont bloquantes : campagne
partielle (1/5 acceptée), saturation observée sur un document long, rappel
oracle de seulement 0,25 sur le seul cas accepté, Sonnet comparable et juges
non disponibles. Une reprise doit re-geler un plafond identique de 65 536
pour tous les modèles, recommencer par Valcourt, puis exécuter les cinq PDF.

## Gels et preuves

- Module T1 : commit `f96356e90a76b14b32ef0e913a82eb5805a9a413`,
  SHA-256 `b1d3989bc826e0691fb644b0b2857099f2c957a44f054bf0b3746adc526dab3f`.
- Manifeste : SHA-256
  `6fea56a246c3d4f361bd64c2c61616cbab6d77458f8fe5deb69a31eaf910c18a`.
- Prompt : SHA-256
  `acb3de708e206828e6b4d3a9db9bcacf5a6e147147e0ae4ec40643123e77ea0b`.
- Contrôle : `control/valcourt-2026-06-01-agenda--gemini-low.receipt.json`.
- Campagne : `campaign-real/*.receipt.json` et `campaign-real/*.raw.txt`.
- Mesures déterministes : `comparison.json`.
- Bundle juge partiel : `blind-bundle.json`, SHA-256
  `ec52dc0fea791335f500b5150bf2fe692dd5fb19555fd05e1741ed03d86ee337`.
