# Dérogation réseau préprod — 27 octobre 2026

Branche `fix/bascule-preprod-network-waiver`, créée depuis `origin/main`
`c30544762a9dd726c695fc96cc8a15fa05852ef6` dans un checkout local isolé.
La section après-midi du rapport 6H a été lue : le refus de 16:36 précédait
toute mutation. Cette livraison applique la décision explicite du conducteur.

Dans l’owner-input, `maintenance.networkIsolation` peut contenir uniquement :

```json
{"waiver":{"reference":"owner-preprod-preaccord-2026-10-27","reason":"Conductor-authorized preprod cutover without CNI qualification"}}
```

La référence est exacte ; la raison est obligatoire, non blanche et bornée.
La dérogation est refusée pour tout namespace autre que
`radar-immobilier-preprod`, y compris prod. Sans dérogation, le comportement
strict existant est conservé. Avec dérogation, seuls le profil NetworkPolicy
des consommateurs et les sondes CNI sont dispensés.

Les gardes PostgreSQL non borné, Ingress/Service sans endpoints, middlewares,
consommateurs arrêtés, CronJobs suspendus, endpoints hors roster, autorisation
métier et SHA complet restent requis. Le reçu réseau et
`maintenance.json.networkIsolation` conservent `mode:"waived"`, référence,
raison, binding, image, contexte et namespace ; leurs empreintes sont conservées.
Aucun reçu positif de qualification CNI n’est produit.

Tests ciblés : **PASSED, 266 cas opérateur**, plus syntaxe shell/diff.
Acceptation préprod, refus hors préprod, déclaration invalide, absence de
dérogation et gardes conservés sont couverts. Commande locale exécutée :
`make -f tmp/bascule-waiver.mk test-operator ENV=test-bascule-waiver`.
La même suite est disponible via `tools/make/bascule-fix.mk test-operator`.
Code/test qualifiés : `7ff339002310c238de0bb96c5fffedfb51797c7d`.

Livraison : `tmp/bascule-waiver-evidence/bascule-waiver.bundle` et
`delivery.json` (base, SHA final, SHA-256 et audit par import distinct,
égalité SHA/arbre, `git fsck`). Commits Conventional anglais ≤72 caractères,
sans corps/trailer, ≤150 lignes chacun. Aucun push, accès cluster, Docker,
Python ou fichier d’environnement lu ; aucune bascule opérationnelle exécutée.
