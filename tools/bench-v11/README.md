# bench-v11 — harnais reconstruit du benchmark d'extraction PV (v101b / v11alpha / v11)

Ce dossier versionne le harnais reconstruit octet par octet pour les bancs
v11alpha, complément Muse Wonder low et v11 (Argon low + Muse Wonder low),
afin que la méthode ne soit plus jamais perdue. Les scripts d'origine
pointent en dur vers le clone d'exécution (`tmp/bench-wonder/`) ; ils sont
conservés ici à l'identique (voir `SHA256SUMS`). Les PDF du corpus ne sont
pas versionnés (volumineux) : le manifeste les identifie par sha256.

## Contenu

- `harness/manifest-v101b.json` — manifeste gelé v101b (100 documents,
  `promptFreeze` ; prompt système sha256
  `bdc1327904ac4c5a36b91dfdbe887a6f1a900b8fe5f1427249e54d83c250d461`).
- `harness/score-oracle-v2.mjs`, `score-oracle-v3.mjs`, `oracle-v3-lib.mjs`,
  `oracle-v3-soft.mjs`, `o3l.mjs`, `precision-cascade.mjs` — scoreur oracle
  v3 (strict, R4 aliases) et cascades.
- `harness/cost-calculator.mjs`, `v101-arms.mjs`, `report-data-v101b.json`,
  `manual-oracle-v2.json` — coûts v10 et référence humaine v2.
- `t1/` — profil d'ontologie gelé v9 et modules gelés
  (`frozen-ontology-profile.yaml`, `frozen-refresh-corpus.ts`,
  `frozen-refresh-profile.ts` ; sha256 dans le manifeste).
- `oracle-676/` — oracle 676 unités (#725) : `consensus.json`,
  `unresolved.json` (43 non résolus neutres en stricte).
- `prompts-verify.json` — revérification des prompts gelés reconstruits
  (`count=100, fail=0`).
- `full/prepare-prompts.mjs` — reconstruction octet par octet des prompts
  gelés depuis le manifeste (portage de `chunkDocument` / `schemaFor` gelés).
- `full/validate-outputs.mjs` — validation profil v9 gelé + provenance
  (gate identique à v11alpha).
- `full/score-676.mjs` — notation oracle 676 (`scoreSource`) ;
  `score-wonder.mjs`, `score-argon.mjs`, `score-v11.mjs` — pilotes par bras.
- `full/run-arm-wonder.sh`, `run-arm-wonder-c10.sh`,
  `run-burn-wonder-usage10.sh` — runners siège Muse (concurrence 1 puis 10).
- `full/run-arm-argon.mjs`, `run-burn-argon.mjs` — runners siège AGY
  (Gemini Argon low, `stream-json`, concurrence 10).
- `full/extract-usage.mjs` — extraction usage + texte terminal Muse `--json`.
- `full/build-oracle-676.mjs`, `build-summary.mjs`, `dl-corpus.mjs` —
  reconstruction oracle 676 et corpus.
- `build-v11-report.mjs` — générateur du dossier v11 (tableaux, graphiques
  SVG, HTML ; PDF via Chromium headless). Les graphiques v10 venaient de
  Matplotlib ; ils sont régénérés en Node dans le même style (règle zéro
  Python du dépôt).

## Méthode (identique v11alpha, seule différence : concurrence 10)

1. `node full/prepare-prompts.mjs` puis vérifier `prompts/verify.json`
   (`count=100, fail=0`).
2. Exécuter le bras (siège uniquement, aucune clé API ; reprise sur quota
   avec attente de 300 s, maximum 12 tentatives ; le quota n'est jamais
   compté comme un refus).
3. `node full/validate-outputs.mjs <armDir>` (lit `<armDir>/raw/*.txt`).
4. `node full/score-wonder.mjs` / `score-argon.mjs` (oracle 676).
5. Burns : échantillon fixe de 10 documents avec capture d'usage
   (`muse exec --json` / AGY `--output-format json`), relevés de compteur
   avant/après, horodatages et sources consignés ; à défaut de compteur
   lisible, `missing source`, jamais d'estimation inventée.

## Vérification des empreintes

```bash
cd tools/bench-v11 && sha256sum -c SHA256SUMS
```
