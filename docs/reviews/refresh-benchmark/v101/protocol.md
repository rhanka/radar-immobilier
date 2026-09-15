# Protocole v101 — benchmark T1 multi-modèles, phase 1

## Décision et limites

Ce protocole prépare le rejeu demandé sur les 100 documents municipaux de v100. Il ne lance aucune
campagne. Certains éléments du corpus sont des ordres du jour : « 100 PV » n'est donc pas retenu comme
description vérifiée. Le contrat produit reste `immo-pv-extraction-v9`, mergé dans `main` par
`4e3a4db8f71fe4824bf9aa9f166d1d47b95211c4`; les deux modules du snapshot d'exécution
`93994e454a91031dcbbd49b8590fdd45b47a6cd4` ont un diff vide avec ce merge.

Décisions de phase 1 : D1 = disponibilité stricte si HTTP 200 et sortie exacte `PING_OK`; D2 = un bras
par modèle × effort; D3 = plafond comparable visé de 32 768 tokens; D4 = concurrence 1 par fournisseur;
D5 = lecture C′ hors ligne, sans mutation du produit; D6 = aucun lancement avant fermeture des gates.

## Disponibilité mesurée le 2026-09-15

Un ping de génération au plus a été fait par bras adressable. Cloud Code effectue en plus son appel de
catalogue interne. Total observé par le journal opérateur : 26 générations, 32 appels HTTP associés,
9 appels de catalogue, soit 41 appels fournisseur; jamais plus de 2 appels HTTP par bras. Les reçus
`catalogs.json` et `ping-*.json` hors `*.lock.json` en prouvent 38; les 3 lectures API exploratoires
antérieures au gel sont un source-gap et ne servent à aucune conclusion d'identifiant.

| Modèle demandé | Transport | Identifiant logique → fil/résolu | Efforts et latence du ping | Plafond de sortie établi | Prix USD/M tokens entrée · sortie |
|---|---|---|---|---|---|
| Gemini 3.8 | Cloud Code Pro | `gemini-3.8-flash` → `gemini-3.8-flash-tiered` / `gemini-3.8-flash` | LOW 18 093 ms OK; MEDIUM 31 203 ms `PING`; HIGH 19 546 ms vide | 64 000 mesuré v100; profil 65 536 | N-A, transport abonnement |
| Codex Luna | Codex Pro, llm-mesh 0.19.2 | `gpt-5.6-luna` | low 1 398; medium 1 462; high 1 376; xhigh 1 327 ms, tous OK | N-A; `maxOutputTokens` absent du fil | N-A, transport abonnement |
| Codex 5.3 | Codex Pro | N-A, absent du catalogue | low/medium/high/xhigh non lancés | N-A | N-A |
| GPT-4.1 | OpenAI API | `gpt-4.1` → `gpt-4.1-2025-04-14` | sans effort, 5 924 ms OK | 32 768 documenté | 2 · 8 |
| Sonnet 4.6 | Cloud Code Pro | `claude-sonnet-4-6` | off 1 652; LOW 1 577; HIGH 2 027 ms, tous OK | 64 000 mesuré; 64 001 refusé | N-A, transport abonnement |
| Sonnet 5 | Anthropic API | `claude-sonnet-5` | off 1 113; low 1 070; high 1 027 ms, tous OK | 128 000 documenté | 2 · 10 |
| Opus 5 | Anthropic API | `claude-opus-5` | off 1 570; low 1 734; high 1 597 ms, tous OK | 128 000 documenté | 5 · 25 |
| Codex Sol | Codex Pro, llm-mesh 0.19.2 | `gpt-5.6-sol` | low 1 893; medium 2 607; high 1 596; xhigh 2 760 ms, tous OK | N-A; `maxOutputTokens` absent du fil | N-A, transport abonnement |
| Codex Astra | Codex Pro, llm-mesh 0.19.2 | `gpt-6-astra` | low 4 746; medium 6 196; high 2 559; xhigh 5 046 ms, tous OK | N-A; `maxOutputTokens` absent du fil | N-A, transport abonnement |
| Mistral Small 4 | Mistral API | `mistral-small-2603` | sans effort, 397 ms OK | max sortie N-A; contexte 262 144 mesuré au catalogue | 0,15 · 0,60 |

Bilan : 24/30 bras satisfont D1; 26/30 sont adressables par leur transport. Gemini MEDIUM/HIGH
acceptent le modèle, l'effort et le plafond 64, mais la pensée consomme le budget et empêche la sortie
exacte. Les quatre bras Codex 5.3 sont indisponibles. Un succès à 64 tokens ne prouve pas un plafond
élevé. Les 12 bras Codex restent conditionnels pour la cohorte comparable jusqu'à matérialisation ou
preuve d'application de `maxOutputTokens=32768` sur le fil.

Sources : reçus `availability/catalogs.json` et `availability/ping-*.json` hors locks; catalogue live et package npm llm-mesh 0.19.2; probes v12 pour
Sonnet 4.6; pages officielles [GPT-4.1](https://developers.openai.com/api/docs/models/gpt-4.1),
[Anthropic models](https://platform.claude.com/docs/en/about-claude/models/overview),
[Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing),
[Mistral Small 4](https://docs.mistral.ai/models/mistral-small-4-0-26-03) et
[Mistral pricing](https://docs.mistral.ai/inference/pricing), consultées le 2026-09-15.

## Corpus et deux lectures

`manifest.json` reprend exactement les 100 documents, 100 villes, empreintes PDF/texte/page et
empreintes prompt/schéma de v100. Toutes les empreintes locales ont été recalculées. Le plafond commun
visé passe de 64 000 à 32 768 : v100 est une référence historique, pas un rejeu exact du plafond.

- Strict : validation v9 intacte, 87/100 sur les reçus v100.
- C′ : si et seulement si le refus localise un unique enregistrement direct, retirer cet enregistrement,
  nettoyer à point fixe les références devenues pendantes, puis repasser la validation v9 complète.
  Compteurs publiés : cible directe, type, retraits en cascade, verdict final.
- Mesure hors ligne : 9 candidats directs; 7 requalifiés; C′ = 94/100. Dollard-des-Ormeaux et
  Sainte-Thècle révèlent ensuite une autre citation non ancrée et restent refusés. Les quatre sorties à
  défauts multiples restent refusées. Le détail et les empreintes sources sont dans
  `cprime-baseline.json`.

C′ est une lecture analytique des mêmes reçus : elle ne modifie ni prompt, ni schéma, ni validateur,
ni réponse brute, et ne devient pas une règle produit.

## Matrice et budget

Matrice demandée = 30 bras : Gemini 3; Luna 4; Codex 5.3 4; GPT-4.1 1; Sonnet 4.6 3; Sonnet 5 3;
Opus 5 3; Sol 4; Astra 4; Mistral 1. Cohorte ping-conforme actuelle D1 = 24 bras; cohorte prête
à la campagne = 0 tant que les gates de runner et plafond ne sont pas fermés.
Chaque bras budgète 2,0 M tokens d'entrée et 0,7 M de sortie (hypothèse owner 20 k/7 k par document).
À titre de contrôle, v100 a mesuré 1,647 M/0,679 M.

Coût API estimé par bras : GPT-4.1 9,60 USD; Sonnet 5 11,00 USD; Opus 5 27,50 USD; Mistral 0,72 USD.
Sous-total connu des 8 bras API = 125,82 USD; pire cas théorique à deux tentatives pleines = 251,64 USD.
Ce sont des bornes basses lorsque des tokens de pensée facturés ne figurent pas dans l'hypothèse 0,7 M.
Cloud Code, Codex et les juges sont N-A : aucun total global monétaire n'est calculable.

Le proxy `latence ping × 100`, sans retry, donne : Cloud Code 0,65 h pour ses 4 bras D1; Codex 0,92 h
pour 12; OpenAI 0,16 h; Anthropic 0,23 h; Mistral 0,01 h. Les cinq lanes en parallèle donnent un
plancher de 0,92 h; le plafond deux tentatives est 1,84 h hors attente quota. La calibration de charge
v100 (19,172 s/doc) donne plutôt 6,39 h pour la lane Codex : cette fenêtre pilote l'exploitation.
Par bras, en heures/100 : Gemini 0,503/0,867/0,543; Luna 0,039/0,041/0,038/0,037;
GPT-4.1 0,165; Sonnet 4.6 0,046/0,044/0,056; Sonnet 5 0,031/0,030/0,029;
Opus 5 0,044/0,048/0,044; Sol 0,053/0,072/0,044/0,077; Astra
0,132/0,172/0,071/0,140; Mistral 0,011; Codex 5.3 N-A. L'ordre suit celui du tableau.

## Plan de lanes et ordre

Lancer cinq lanes fournisseur en parallèle, concurrence interne 1. Le ping n'a pas mesuré de débit
soutenu; OpenAI annonce 10 000 requêtes et 30 M tokens, Anthropic 10 000 requêtes et 12 M tokens sans
unité temporelle capturée, Cloud/Codex/Mistral n'ont pas fourni de limite exploitable. Monter la
concurrence sans mesure créerait un biais de throttling.

1. Cloud Code : `sonnet46-cloud-off`, `-low`, `-high`, `gemini-low`; MEDIUM/HIGH attendent un nouveau
   gate autorisé. 2. Codex : Luna low→xhigh, Sol low→xhigh, Astra low→xhigh, après gate plafond.
3. OpenAI : `gpt41`. 4. Anthropic : Sonnet 5 off→high puis Opus 5 off→high. 5. Mistral :
`mistral-small4`. Dans chaque lane, ordre des documents déterministe par hash et rotation des efforts
par bloc afin de répartir les dérives temporelles.

Le point d'entrée unique reste `tools/refresh-benchmark/run-arm.mjs <bras>`. En phase 1, la commande
existante est `make -C tools/refresh-benchmark ping-v101 ARM=<bras> ENV=test-t1-model-benchmark`.
Le mode campagne, à réaliser avant exécution, doit écrire une intention exclusive avant réseau, un reçu
immuable par document/tentative, sauter tout reçu terminal et s'arrêter sur un état `in-flight` incertain.
Il ne doit jamais écraser un reçu.

`maxAttempts=2` ne vaut que pour réseau/DNS/TLS/timeout, HTTP 408/425/5xx ou flux sans terminal. Un 429
met toute la lane fournisseur en pause jusqu'à `Retry-After`/reset. Auth, modèle, entrée et autres 4xx ne
sont pas retentés. HTTP 200 avec JSON/schéma/profil/provenance invalide ou `max_tokens` est un résultat
qualité, sans retry. Budget : 100 appels normaux, 200 maximum par bras.

## Juges, synthèse et gates

Avant les sorties, geler 25 documents par taille/page (8 S, 8 M, 8 L, 1 ancre), sélection hashée sans
regarder le verdict. Deux candidats hors bras et hors identité exposée sont `gpt-5.6-terra` (Codex) et
`gpt-oss-120b-medium` (Cloud Code); leur préflight et leur contexte utile restent un gate. Une unité de
jugement est `(document, bras, juge)` avec texte et sortie bruts, soit 1 200 appels pour 24 bras
(1 500 si 30); environ 32,4 M tokens d'entrée au plan 20 k + 7 k. Randomiser l'ordre et les alias des
unités. Les juges notent couverture, exactitude des actes/citations et utilité, sans voir modèle, effort,
strict/C′; C′ reste une projection déterministe jointe après jugement.

Synthèse : matrice document × bras avec acceptation strict/C′, latence, tokens, coût et deux jugements;
IC binomial par bras, différences appariées/bootstraps par document et McNemar exact face à Gemini LOW.
Les comparaisons multiples restent exploratoires; un seul tirage par document ne mesure pas la variance
intra-modèle. Publier désaccord inter-juges et résultats par strate.

Gates avant campagne : implémenter/tester le mode 100 documents idempotent; prouver le plafond filaire
commun ou exclure le transport; statuer Gemini MEDIUM/HIGH sans second ping dans cette lane; conserver
Codex 5.3 hors matrice tant qu'un identifiant live n'existe pas; préflighter les deux juges; faire ratifier
coût et cohorte; vérifier zéro secret. Aucune campagne n'est autorisée par ce document.
