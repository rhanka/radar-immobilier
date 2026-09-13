# First real-PDF acceptance candidate

Status: source oracle selected and original-PDF page 3 re-extracted on
2026-09-13; live API acceptance remains required. No new LLM call has been made.

## Frozen reusable inputs

- Read-only run: `.lanes/conductor/tmp/graphify-cas/run-dryrun2-final-20260911T215911Z`
  under the repository root, not this worktree.
- Manifest SHA-256: `6617d783442ce41b86e13f7be1b7546ef7357c626899db6a7ba2e1267e1f7607`.
- The saved report records 139 verified documents, 40 city candidates and 330
  calls; zero published candidates. These are historical candidate results,
  not acceptance of this implementation or a scheduled refresh.
- Preserve PR678 baseline merge and explicit exclusions from
  `origin/feat/graphify-v23-cas-ingest` at `ab98ce5b` without rerunning its CLI.

## Regulatory oracle

- City: Waterloo; municipal meeting: 2026-08-18.
- [Original public PDF](https://ville.waterloo.qc.ca/wp-content/uploads/2026/09/Proces-verbal-de-la-seance-du-18-aout-2026.pdf).
- PDF SHA-256, independently recomputed from saved bytes:
  `c18dcea9adf05d028f5ee1c71b2244fb3dc5e83acdab86996c81401d4038cebd`.
- Object key: `raw/proces-verbaux-waterloo/cas/c18dcea9adf05d028f5ee1c71b2244fb3dc5e83acdab86996c81401d4038cebd.pdf`.
- Resolution `26.08.22.1`: adoption of zoning amendment `26-956-2`, concerning
  integrated projects; submitted to the MRC for a conformity certificate.
  Do not infer that it is already in force or invent permitted unit counts.
- Exact excerpt: “Que le conseil municipal adopte le Règlement 26-956-2 modifiant
  le règlement de zonage afin de modifier l'encadrement des projets intégrés
  tel que soumis”. Whitespace normalization may join original line wraps only.

## Page-mapping regression to test

The saved extraction assigns this finding to **page 1**, but counting original
form-feed separators in its saved parsed text puts the excerpt on **page 3**.
Parsed-text SHA-256: `f94a4872ef4c85875359698405f4462e49d54e55e493e2ecf7ca9e83b7175647`.
`pdftotext -f 3 -l 3 -layout <exact-pdf> -`, through the inspection Make target,
independently reproduced the adoption excerpt and MRC conformity submission on
page 3. Do not reuse the old model-generated page value as evidence. The negative test
must reject the same quotation attributed to page 1. No published graph is
modified as part of selecting this input.
