# Protocole gelé T1 v8

## Question

À contrat constant, `thinkingLevel=HIGH` améliore-t-il l'acceptation et le
rappel de `gemini-3.8-flash-tiered` par rapport à v7 LOW, et à quel coût de
latence et de tokens ?

## Delta unique v7 → v8

Le seul delta expérimental est l'effort demandé : `low` / `LOW` devient
`high` / `HIGH`. L'identifiant wire demeure `gemini-3.8-flash-tiered`; le
catalogue Cloud Code ne fournit pas de suffixe `-high` pour ce modèle.

Restent inchangés : les cinq PDF et leurs textes, le profil produit au commit
`f96356e90a76b14b32ef0e913a82eb5805a9a413`, Graphify 0.18.0, llm-mesh
0.19.1, le prompt système, les cinq prompts, les cinq schémas, le plafond de
65 536 tokens, le timeout de 480 s, `maxAttempts=2` limité aux échecs transport,
le validateur, l'oracle et les métriques. Aucune retry qualité n'est permise.

## Garde d'exécution

Le contrôle Valcourt consomme une requête. S'il n'est pas accepté, la campagne
s'arrête. Sinon, chaque PDF est demandé une fois. Un HTTP 429 ou une saturation
arrête immédiatement la campagne et produit un livrable partiel. Le brut et le
reçu v2 sont persistés avant validation; le reçu conserve la fin SSE et l'usage
brut filtré, y compris `thoughtsTokenCount` lorsqu'il est fourni.

## Empreintes du gel

- Manifeste v8 : `c32a16c79154c10dceaaa67b37d245a3748276a3a7f7fba727152aa541858519`.
- Prompt/schémas v8 : `9a167db24fa6cb147a8d9f8966e38df895322330a828bb89afdb926b3fd6da21`.
- Oracle v8 : `4d50a26c869283199c58dcb75cf4055bccb39f988a9c700c026ddd0a1ef87130`,
  byte-identique à v7.
- Module profil : `b1d3989bc826e0691fb644b0b2857099f2c957a44f054bf0b3746adc526dab3f`.
- Module corpus : `461ed2c1d5da3892d5333d08d5910f57ee1516002fc41711f7c1c8b26570b903`.
- Prompt système : `bdc1327904ac4c5a36b91dfdbe887a6f1a900b8fe5f1427249e54d83c250d461`.

Les différences de `frozenAt` et de champ `campaign` sont des métadonnées de
gel, pas des variables expérimentales. Le test v8 compare les structures v7 et
v8 après retrait de ces deux champs et compare directement les octets oracle.
