gemini-low: 15 refus → cumulé 1/2/3 = 2/2/N-A · cascade gemini-low→astra-low: acceptés 100/100, F1 N-A, API N-A, siège N-A · appels utilisés 76/90

Statut : mesuré partiel. Le circuit autorisé a produit des reçus Gemini sous replay-test sans modifier campagne ni manifeste. Les workers ont été arrêtés alors que certains documents restaient en attente ; les valeurs non observées sont N-A.

- Outil : BENCHMARK_DOCUMENT_IDS ajouté après BENCHMARK_SLICE, avec test.
- Rejeu : cloud-code, concurrence 2, aucun événement 429 relevé.
- Reçus et latences/tokens/coûts observés : retry-proof.json.
- Cascade : Astra-low est 100/100 ; le mélange document par document, F1 et coûts consolidés restent N-A (source-gap de clôture).
- Le test complet conserve un échec préexistant sur l’identifiant local Opus.
