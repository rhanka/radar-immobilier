# Benchmark T1 — décision M1

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
