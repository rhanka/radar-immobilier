# Validation locale de la cascade — 2026-09-17

## Résultats automatisés mesurés

- `refresh-model-policy.test.ts` : 25 tests PASS. Il couvre le refus qualité Gemini rejoué une fois puis Astra, le réglage à un essai, les bascules immédiates quota/429, transport, délai et flux vide, le disjoncteur après trois documents quota, la reprise et les reçus durables.
- `refresh-state.test.ts` : 10 tests PASS. Les reçus conservés portent le modèle, `attempt`, `transition` et le motif redacted.
- `refresh-018.spec.ts` : 6 tests PASS contre PostgreSQL et MinIO. La reprise après interruption conserve Astra comme affinité après quota Gemini et ne régénère pas les fragments terminés.
- `verify-renders` : PASS pour les overlays préproduction et production : seul `radar-refresh-pv` est actif, avec Gemini low, deux essais qualité et Astra low.
- Typecheck : PASS; `svelte-check` signale 0 erreur et 7 avertissements préexistants. Lint : PASS. Les volumes `test-cascade-703` ont été supprimés après exécution.

## Documents publics réels

La recette avec deux documents publics et comptes mesh réels est **non exécutée** dans cette lane : aucun secret, keyring, appel fournisseur ou action préproduction n'a été utilisé. Les deux documents et les reçus d'exécution doivent être consignés par la lane k8s après fusion et cleanse de `refresh/018/*`; le protocole est dans `production-acceptance.md`. Aucun taux réel de cette recette n'est donc déclaré ici.

## Référence de mesure conducteur

La mesure conducteur du corpus v101b établit 85/100 acceptés par Gemini low au premier essai; le second essai récupère 10 des 15 refus, puis Astra couvre les 5 restants, soit 100/100 attendu. Le coût calculé est 0,064 USD/document contre 0,407 USD pour Astra low seul, soit 6,4× inférieur; la communication de décision le présente comme un ordre de grandeur de 4 à 6×. Cette mesure est distincte de la recette préproduction à venir.
