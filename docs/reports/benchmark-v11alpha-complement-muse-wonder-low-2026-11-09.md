# Benchmark d'extraction PV — complément v11alpha : Muse Wonder, effort low

- **Date** : 2026-11-09
- **Statut** : **complément v11alpha**. Ce document ajoute une seule ligne au benchmark v11alpha (`benchmark-v11alpha-2026-09-29.md`) : le bras **Muse Wonder, effort low**, exécuté strictement selon la même méthode que v11alpha. Aucune ligne existante n'est rescorée ni modifiée.
- **Cartes** : #782 (mise à jour du benchmark), #697 (finaliser le benchmark), #725 (oracle).
- **Demande owner** : « utilise strictement la même méthode stp pas de triche » — règle « Fair Benchmarking — No Cheating » (`rules/MASTER.md`).

## 1. Protocole

- Corpus : les 100 documents du manifeste v101b (sha256 PDF vérifiés), mêmes prompts gelés (sha256 identiques au v10), même validation (profil v9, provenance) et même notation (score oracle v3, strict), sur l'**oracle 676** (#725, 43 non résolus neutres).
- Prompts gelés revérifiés avant exécution : reconstruction octet par octet depuis le manifeste v101b, `count=100, fail=0` (schemaSha256, promptSha256 et longueurs en octets conformes au `promptFreeze` du manifeste ; prompt système sha256 `bdc1327904ac4c5a36b91dfdbe887a6f1a900b8fe5f1427249e54d83c250d461`).
- Validation : profil v9 + provenance, chaîne identique à v11alpha (`validate-outputs.mjs`, gate `validatedExtraction` du profil gelé).
- Notation : scoreur oracle v3 strict identique à v11alpha (`score-676.mjs` / `score-oracle-v3.mjs`, oracle 676 unités, 43 non résolus neutres).
- **Siège uniquement, aucune clé d'API** (règle owner) :
  - **Muse Wonder** (`muse-wonder-1.0`) : CLI `muse exec --provider meta --model muse-wonder-1.0 --reasoning-effort low --prompt-file <prompt gelé>`, abonnement Muse (siège), sans clé API. CLI observée : Muse Code `1.4.14 (1.4.14-R7309.1)`.
- **Seule différence de protocole : concurrence 10** (amendement owner du 2026-11-09), au lieu de la concurrence 1 de v11alpha. Corpus, octets des prompts, validateur, scoreur et oracle sont inchangés. Conséquence : les latences p50/p90 ci-dessous sont mesurées sous concurrence 10 et **ne sont pas comparables** aux colonnes de latence de v11alpha. P, R, F1 et Acceptés ne sont pas affectés par la concurrence.
- Reprise sur quota de siège : les erreurs de quota / limite de débit (429, usage limit) ne sont **jamais** comptées comme des refus ; le document est attendu puis repris, exactement comme en v11alpha (« reprise sur quota de siège »). Sur ce passage : **0 événement de quota**, 100 documents terminés au premier essai (`attempt=1`, `exit=0`).

## 2. Classement global sur 100 documents (extrait, ligne ajoutée)

Reprise du tableau v11alpha §2, avec insertion de la nouvelle ligne. Les autres lignes sont recopiées sans rescoring.

| # | Modèle · effort | Acceptés /100 | P | R | **F1 strict** |
|---|---|---|---|---|---|
| 1 | **CP actuel** (astra-medium → gemini low) | 99 | 0,484 | 0,533 | **0,507** |
| 2 | CP-low (astra-low → gemini low) | 100 | 0,479 | 0,491 | 0,485 |
| 3 | Astra medium | 99 | 0,371 | 0,534 | 0,438 |
| 4 | Astra low | 100 | 0,373 | 0,491 | 0,424 |
| 5 | Sol medium ᵃ | 94 | 0,444 | 0,398 | 0,420 |
| 6 | Sol low ᵃ | 90 | 0,465 | 0,358 | 0,404 |
| 7 | C2 ᵃ | 100 | 0,456 | 0,358 | 0,401 |
| 8 | C3 ᵃ | 100 | 0,461 | 0,353 | 0,400 |
| 9 | Sol xhigh | 85 | 0,308 | 0,488 | 0,378 |
| 10 | Gemini low | 85 | 0,475 | 0,300 | 0,368 |
| 11 | Sol high | 82 | 0,377 | 0,337 | 0,356 |
| 12 | **Muse Wonder low (siège)** | 90 | 0,361 | 0,333 | **0,346** |
| 13 | Opus 5.5 medium (siège) | 93 | 0,328 | 0,311 | 0,319 |
| 13 | Opus 5 low (API) ᵃ | 74 | 0,350 | 0,292 | 0,319 |
| 15 | Gemini medium | 79 | 0,449 | 0,223 | 0,298 |
| 19 | Muse 1.3 medium (siège) | 80 | 0,355 | 0,207 | 0,262 |
| 20 | Opus 5.5 low (siège) | 90 | 0,325 | 0,217 | 0,260 |
| 26 | Muse 1.3 low (siège) | 77 | 0,347 | 0,170 | 0,228 |

ᵃ = valeur du rapport v10 (oracle 674 ; sorties locales incomplètes ou absentes), telle que publiée en v11alpha.

La ligne Muse Wonder low prendrait le **rang 12** du classement v11alpha (38 lignes classées + 1 ligne coupée), devant Opus 5.5 medium et derrière Sol high.

## 3. Détail du nouveau bras (100 documents)

| Bras | Tentés | Acceptés | Échecs (J · V · T) | F1 net 4 doc | p50 s | p90 s | Sortie moy. (jetons) | Équiv. API USD/doc | USD siège/doc |
|---|---|---|---|---|---|---|---|---|---|
| Muse Wonder low | 100 | 90 | 1 · 9 · 0 | 0,306 | 48,3 ¹ | 108,1 ¹ | 4 250 ² | N-A | N-A ³ |

J = JSON invalide ; V = profil v9 refusé (inclut la provenance le cas échéant ; sur ce bras, provenance = 0 refus séparé) ; T = transport / réponse vide.
¹ Latences mesurées sous **concurrence 10** : non comparables aux colonnes p50/p90 de v11alpha (concurrence 1).
² Estimation octets/4 depuis la taille des sorties (la CLI Muse n'expose pas les jetons du fournisseur sur ce passage) : `unverified`. Moyenne des octets de sortie : 17 002 octets/document.
³ Coût siège Muse non mesuré (pas de mesure de consommation de l'abonnement) : `missing source`. Aucun équivalent API publié pour `muse-wonder-1.0` dans le protocole v11alpha : `N-A`.

Détail du scoring strict (oracle 676) : TP 225, FP 399, FN 451, P 0,361, R 0,333, F1 0,346. Colonnes secondaires (même scoreur, non publiées en v11alpha pour ce bras) : F1 broad 0,340, F1 stage-tolerant 0,409, F1 soft 0,355.

## 4. Lecture

- **Muse Wonder low** (F1 strict 0,346, 90/100 acceptés) se place au-dessus de tous les bras Muse 1.3 de v11alpha (meilleur Muse 1.3 : medium, 0,262) et d'Opus 5.5 medium en siège (0,319), et en dessous de Sol high (0,356) et Gemini low (0,368).
- Le combo actuel CP (0,507) reste premier ; aucun modèle seul ne l'égale.
- Les refus sont surtout des refus de profil v9 (V = 9) ; un seul JSON invalide (J = 1), aucun échec de transport (T = 0), aucun événement de quota de siège.

## 5. Traçabilité et preuves

- Harnais retrouvé hors `main`, sur les branches distantes `feat/t1-model-benchmark-real`, `docs/bench-v11alpha` et `docs/rapport-benchmark-v101b` (manifeste v101b, oracle, scoreurs), et reconstruit à l'identique dans le clone d'exécution.
- Runner : même commande `muse exec` que les bras Muse 1.3 de v11alpha, avec `--model muse-wonder-1.0` et `--reasoning-effort low` ; continuation en concurrence 10 (`run-arm-wonder-c10.sh`, reprise sur quota avec attente de 300 s, jusqu'à 12 tentatives, jamais de bascule vers une clé).
- Reçus et évidences (clone d'exécution, non versionnés avec ce rapport) : `tmp/bench-wonder/full/arms/muse-wonder-low/meta.jsonl` (100 terminés, 0 quota), `tmp/bench-wonder/full/arms/muse-wonder-low/raw/` (100 sorties brutes), `tmp/bench-wonder/full/arms/muse-wonder-low/validated/` (90 sorties acceptées, 100 reçus de validation), `tmp/bench-wonder/full/prompts/verify.json` (100 prompts vérifiés, 0 échec), `tmp/bench-wonder/full/scores-wonder.json` (scores oracle 676).
- Aucune ligne existante de v11alpha n'a été rescorée ni altérée.
