# Investigation zones géo — 2/30 régression ou artefact ? (2026-06-28)

## Verdict : ARTEFACT DE MESURE (atome sweep buggé) + trou réel sur le focus:30

### Contradiction observée
- API geo OGC (wp1-data-state / focus-rollup) : zonage 211/1104, 2/30 ; lots 1102/1104.
- Atome sweep (wp1-atome-par-ville-full.tsv) : zonage 3/1104, 3/30 ; lots 320/1104.

### Arbitrage (mesure directe API api.geo.sent-tech.ca/collections, 2695 collections)
- **506 collections `qc-zonage-*`**, **1103 collections lots cadastre**.
- Couverture zonage par match nom-de-ville : **focus:30 = 3/30**, **focus:1104 = 234/1104**.
- => l'API (211–234/1104) est la source fiable. **La colonne zones_geo/lots_geo de l'atome sweep est BUGGÉE** (sous-compte 3 vs 234, 320 vs 1103) — NE PAS l'utiliser ; à régénérer.

### Pourquoi l'écart
Nommage geo non canonique : `qc-zonage-<ville>-<couche>-<hash>-arcgis` → **506 fragments ArcGIS** (plusieurs par ville). Les heuristiques de match (slug exact vs substring) donnent des chiffres très différents. Aucun comptage stable tant que la couche n'est pas réduite à 1 collection canonique/ville.

### Trou RÉEL (pas un artefact)
Sur les 30 villes focus (banlieues MTL prioritaires), seules **3** ont une collection zonage. Les 506 collections couvrent surtout des villes HORS top-30. => le zonage géo des villes démo est un vrai trou de livraison geo, pas une erreur de mesure.

### Reco
1. Marquer la colonne zones_geo/lots_geo de wp1-atome-par-ville-full.tsv comme non fiable (régénérer via l'API, pas le sweep S3).
2. Exécuter le **task #92** (purge `SUPERSEDE -arcgis`, pull canonique 1 collection/ville) — prérequis à tout comptage zonage stable.
3. Prioriser la livraison zonage geo des 27 villes focus sans zonage (geo).

### Régression ?
Pas de preuve de régression franche (purge) côté province ; 234/1104 ≈ stable. Le « 2/30 » n'a jamais été beaucoup plus haut sur le focus:30 — ces villes n'ont simplement pas encore de zonage canonique.
