# Benchmark T1 — décision M1

## Campagne v8

À contrat identique sauf `thinkingLevel=HIGH`, Gemini conserve 3/5 sorties
acceptées mais le F1 macro calculable baisse de 0,436 à 0,200 et le rappel
macro des acceptés de 0,361 à 0,083. La latence moyenne passe de 25,7 s à
81,8 s (×3,18) et l'usage fournisseur de 108 970 à 207 201 tokens (×1,90),
dont 76 833 tokens de pensée désormais déclarés. LOW demeure donc la M1
provisoire sans promotion. Waterloo possède un oracle partiel : sa précision
et son F1 HIGH sont `N-A`.

Le [rapport v8](v8/report.md), le [bundle aveugle](v8/blind-bundle.json) et la
[consigne juge](v8/judge-prompt.md) portent le détail. Aucun juge v8 n'a été
lancé; les juges v7 en cours ne sont pas lus ni modifiés par cette campagne.

## Campagne v7

Le plafond commun de 65 536 a permis d'exécuter le contrôle Valcourt puis les
cinq PDF sans 429 ni saturation : 5/5 HTTP 200 et `STOP`, 3/5 sorties acceptées.
Le F1 macro des cas acceptés est 0,436. Saint-Barthélemy échoue le profil et
Waterloo la provenance. `gemini-3.8-flash-tiered` LOW est la M1 provisoire,
sans promotion, en attente des deux jugements aveugles lancés par le conductor.

Le [rapport v7](v7/report.md), le [bundle aveugle](v7/blind-bundle.json) et la
[consigne juge](v7/judge-prompt.md) portent le détail, les SHA et les réserves.

## Campagne v5 — historique

Le contrôle préalable Valcourt du contrat corrigé a reçu HTTP 200, puis a
échoué au parse strict : la réponse possède un fence ouvrant et un JSON
incomplet. La validation profil n'a pas été atteinte. Le garde a arrêté la
campagne après 1 requête Gemini sur 8; 0/5 sorties de campagne sont acceptées.
Sonnet et les juges sont `N-A`.

**Décision actuelle : ne promouvoir aucun modèle en M1.** Le tableau complet,
les limites de la mesure, les SHA du gel et les chemins des preuves sont dans
[`v5/report.md`](v5/report.md). La campagne v4 ci-dessous demeure historique.

## Campagne v4

### Ping G et couture 0.19.1

Le ping G a réussi : HTTP 200, message exact `PING_OK`, 929 ms. Le wire a
porté `gemini-3.8-flash-tiered`, `thinkingLevel=LOW` et
`maxOutputTokens=64` sur le endpoint `daily` fourni par
`@sentropic/llm-mesh@0.19.1`. Le bearer et le projet sont masqués dans
`v4/gemini-integration-preflight-g.json`.

La configuration `gemini-low` fixe désormais l'identifiant wire annoncé par
`fetchAvailableModels`. Comme le planner statique de 0.19.1 ne connaît pas
encore cet identifiant, radar lui fournit un profil local dérivé du profil
Gemini 3.8 et une route épinglée qui acquiert le même compte Cloud Code avant
d'appeler l'adaptateur publié. Le transport 0.19.1 et `node_modules` ne sont
pas modifiés. Cette couture doit disparaître quand le mapping de 0.19.2 sera
disponible.

### Contrat exécuté

- Cinq PDF municipaux réels gelés, Graphify 0.18.0 et llm-mesh 0.19.1.
- Même prompt, schéma, texte PDF, plafond de 16 384 tokens et politique de
  retry que la campagne gelée.
- Gemini 3.8 Flash wire `gemini-3.8-flash-tiered`, effort fournisseur LOW.
- `generateValidated` a enregistré chaque réponse invalide via
  `recordOutcome`; aucun repli compatible n'était disponible et aucun retry
  qualité n'a été envoyé.
- Le premier cas Lac-des-Seize-Îles possède un reçu préalable sans HTTP
  (`Unknown requested model`) puis un seul appel modèle après correction de la
  route. Ce pré-échec local n'est pas compté comme appel PDF ni retry qualité.

### Tableau PDF × modèle

Les scores juges Luna sont les utilités historiques Sol/Astra sur 5. Gemini
et Sonnet comparable n'ont pas de score : aucune sortie candidate n'a franchi
le validateur. `N-A` signifie non disponible dans cette campagne.

| PDF | Modèle | Statut | Latence | Validité JSON / contrat | Score juge |
| --- | --- | --- | ---: | --- | --- |
| Lac-des-Seize-Îles | Gemini 3.8 Flash LOW | HTTP 200, validation échouée | 12 308 ms | invalide / `recordOutcome` | N-A |
| Lac-des-Seize-Îles | Sonnet 4.6 comparable | N-A, aucun appel | N-A | N-A | N-A |
| Lac-des-Seize-Îles | Luna low historique | HTTP 200, validation échouée | 86 244 ms | échec validateur | 4 / 4 |
| Saint-Étienne-de-Bolton | Gemini 3.8 Flash LOW | HTTP 200, validation échouée | 46 652 ms | invalide / `recordOutcome` | N-A |
| Saint-Étienne-de-Bolton | Sonnet 4.6 comparable | N-A, aucun appel | N-A | N-A | N-A |
| Saint-Étienne-de-Bolton | Luna low historique | HTTP 200, validation échouée | 191 185 ms | échec validateur | 4 / 3 |
| Valcourt | Gemini 3.8 Flash LOW | HTTP 200, validation échouée | 14 353 ms | invalide / `recordOutcome` | N-A |
| Valcourt | Sonnet 4.6 comparable | N-A, aucun appel | N-A | N-A | N-A |
| Valcourt | Luna low historique | HTTP 200, validation échouée | 44 123 ms | échec validateur | 2 / 2 |
| Saint-Barthélemy | Gemini 3.8 Flash LOW | HTTP 200, validation échouée | 32 057 ms | invalide / `recordOutcome` | N-A |
| Saint-Barthélemy | Sonnet 4.6 comparable | N-A, aucun appel | N-A | N-A | N-A |
| Saint-Barthélemy | Luna low historique | HTTP 200, validation échouée | 101 517 ms | échec validateur | 2 / 2 |
| Waterloo | Gemini 3.8 Flash LOW | HTTP 200, validation échouée | 51 602 ms | invalide / `recordOutcome` | N-A |
| Waterloo | Sonnet 4.6 comparable | N-A, aucun appel | N-A | N-A | N-A |
| Waterloo | Luna low historique | HTTP 200, validation échouée | 177 728 ms | échec validateur | 3 / 3 |

Gemini totalise 5/5 HTTP 200, 0/5 JSON valide, 0/5 extraction acceptée,
156 972 ms au total (moyenne 31 394,4 ms), 67 397 tokens d'entrée et
46 553 tokens de sortie, soit 113 950 tokens. Aucun 429 n'a été observé.

Sonnet est `N-A` avec une nuance importante : le client autonome existe dans
`api/src/services/chat/mesh-runtime.ts` et une clé hors dépôt a été détectée
sans être lue ni affichée. La variable du processus est absente, le keyring
llm-mesh contient zéro compte Anthropic, et les deux méthodes proposées pour
charger `.env.prod` ont été refusées par le garde de sécurité. Aucun appel
Anthropic n'a donc été envoyé. Les cinq reçus Sonnet conservent cet état sans
secret.

### Jugement

Aucun nouveau juge n'a été appelé : les cinq réponses Gemini sont invalides
et aucune sortie Sonnet comparable n'existe. Un jugement de contenu aurait
donc porté sur un ensemble incomplet et non accepté. Les reçus historiques
`judge-sol-xhigh.json` et `judge-astra-xhigh.json` restent valides uniquement
pour Luna low et Sonnet historique; ils ne scorent pas Gemini ni Sonnet
comparable.

### Décision M1 recommandée

**Ne retenir aucun modèle pour le CronJob de production.** Gemini franchit le
transport mais échoue le contrat JSON sur 5/5 PDF; Luna historique échoue le
validateur sur 5/5; Sonnet comparable n'est pas mesuré. La promotion M1 doit
rester bloquée jusqu'à ce qu'un candidat atteigne 5/5 sorties acceptées sur
ce corpus puis reçoive les deux jugements aveugles prévus.

Mesuré : wire Gemini, effort, plafond, HTTP, latence, tokens, validation,
`recordOutcome`, absence de 429 et corpus de cinq PDF. Non couvert : qualité
sémantique Gemini, débit CronJob, coût, quota causal, Sonnet comparable,
fallback multi-route et comportement de llm-mesh 0.19.2.

Les données structurées de synthèse sont dans `v4/campaign-summary.json`; les
reçus PDF × modèle sont dans `v4/campaign-real/`.

## Décision M1 consolidée — v9

[FAIT] Le rejeu exact LOW v9 accepte 3/5 PDF, comme v7, sans variation de la
décision d'acceptation sur les cinq cas. Les écarts F1 observés v7 → v9 sont
Lac 0,000, Saint-Étienne +0,364, Valcourt 0,000, Saint-Barthélemy N-A et
Waterloo N-A. Deux observations par PDF ne donnent pas une variance statistique.

[JUGEMENT] La recommandation M1 consolidée est **B** : attendre la clarification
du statut et des `evidence_refs`, puis exiger au moins 4/5 acceptés sur deux
runs avant promotion. Le choix owner A/B/C/D et ses faits contradictoires sont
présentés dans [DECISION_M1.md](DECISION_M1.md).

## Campagne v12 — Sonnet comparable

[FAIT] La case « Sonnet comparable : `N-A` » de v9 est levée. À gel identique à
v9 — produit `f96356e9`, profil `b1d3989b…`, mêmes cinq PDF, même prompt, delta
réduit au modèle et au transport — `claude-sonnet-4-6` obtient **0/5 sorties
acceptées en direct Anthropic et 0/5 en Cloud Code**, contre 3/5 et F1 macro
0,558 pour Gemini LOW v9.

[FAIT] Les dix appels modèle ont reçu HTTP 200 : ce n'est pas un échec de
transport. Les dix sorties franchissent normalisation et extraction (10/10) puis
tombent aux couches métier — profil 2/5 en direct et 3/5 en Cloud Code,
provenance 0/5 des deux côtés. Aucun P/R/F1 Sonnet n'est calculable, le scoreur
n'évaluant que les sorties acceptées : la qualité sémantique de Sonnet sur ce
corpus reste **non mesurée**. Latence moyenne 137,3 s en direct et 130,5 s en
Cloud Code, contre 30,7 s pour Gemini; p95 observés 243,2 s, 223,6 s et 47,1 s.
Coût unitaire `N-A` : le dépôt ne porte aucun tarif par token, seulement des
forfaits au siège sans dénominateur en tokens.

[FAIT] Deux familles de refus dominent. `unknown_status` frappe trois PDF en
direct et deux en Cloud Code : c'est l'ambiguïté de contrat déjà documentée en
v9 — le profil décrit les valeurs métier (`en_vigueur`, `actif`, `projet`) en
prose tandis que le validateur compare `status` à la liste générique de
durcissement. Sonnet écrit la valeur métier, Gemini LOW la valeur générique.
`ungrounded_pdf_excerpt` frappe les autres cas, refus que Gemini subit aussi sur
Waterloo. Avant requalification, les dix reçus portent en outre
`missing_citation_source_file` sur toutes les entités : Sonnet n'émet pas
`source_file` dans ses citations.

[FAIT] Le transport Cloud Code refuse le plafond gelé de 65 536 (sondes :
64 000 → 200, 64 001 → 400, 65 536 → 400) et tourne à 64 000. L'écart n'a
tronqué aucune sortie : cinq fins `STOP`, jamais `MAX_TOKENS`, plus longue
sortie à 39 % du plafond appliqué.

[FAIT] Un seul incident transport : Saint-Barthélemy direct, tentative 1,
`ETIMEDOUT` après 3 528 s. La relance contractuelle (`maxAttempts=2`,
`retryOnlyAfter=transport_failure`) a reçu HTTP 200 en 126 s. Aucune relance de
qualité n'a été faite.

[FAIT] Le bundle aveugle `v12/blind-bundle.json` (`15794e4e…`) est gelé avec sa
map et son prompt de juge; aucun juge n'a été lancé. Il ne contient que trois
entrées sous un alias unique, faute de sortie Sonnet acceptée : **aucun
classement entre systèmes n'en sortira**. Il est livré comme artefact de
traçabilité.

[JUGEMENT] Ce résultat ne suffit pas à écarter Sonnet du corpus M1. Deux des
trois familles de refus pointent vers le contrat (`status` ambigu, `source_file`
non exigé explicitement) plutôt que vers la compétence du modèle, et la
recommandation B de v9 — clarifier le statut et les `evidence_refs` avant
d'exiger 4/5 — vaut donc aussi pour Sonnet. Rejouer Sonnet après cette
clarification est le prochain test utile; conclure maintenant sur le modèle
reviendrait à conclure sur le validateur.

Détail, reçus et SHA : [v12/report.md](v12/report.md).
