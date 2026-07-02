# Blocages / points à confirmer

Aucun blocage bloquant pour la V2 du rapport (élévation qualité étude/livraison). Le rapport reste
rigoureux : chaque chiffre non stabilisé est marqué `[à consolider]`.

## Résolu / consolidé en V2 (par rapport à la V1)

- Rappel mapper : ajout de la **3e mesure finale 71/120 = 59,2 %** (29 juin), au-delà du 57,3 % de
  la V1. Progression honnête 47,3 % → 57,3 % → 59,2 % documentée avec causes et plafond ~57–59 %.
- **geo live vs projection PG** : clarifié — le mapper lit `zone_versions`/`lot_versions` (PostGIS),
  peuplées par le pull OGC ; la fraîcheur dépend du dernier job réussi, pas d'un accès temps réel.
- **CronJobs de refresh suspendus (FinOps)** : intégré (`deploy/k8s/34-refresh-cronjob.yaml`,
  `suspend:true`, `ttlSecondsAfterFinished`), présenté comme décision de coût assumée.
- **PV hard-scrape / villes dures** : intégré (manifeste des villes irréductibles : anti-bot 403,
  WordPress sans PDF PV, périmètres non résolus) ; les ~97 villes sans brut = préalable scraping.
- **Archive PDF S3 + repli** : intégré (route `/api/documents/raw` sonde l'archive scraping puis
  retombe sur le store de métadonnées ; viewer pdf.js).
- **Reliquat v2.3** : décomposé 128 = ~30 v2.2 (re-grounding) + ~97 sans brut ; focus 30 v2.2 = 1
  publié / 29 bloquées ; grounding v2.2 partiellement halluciné (ex. 12/12 identifiants orphelins).

## Points à consolider avant livraison finale (avec hypothèse par défaut)

| Question | Hypothèse par défaut | Impact si non répondu | Source consultée |
|---|---|---|---|
| Couverture PG fraîche après `populate-geo` daily | jobs présents mais refresh **suspendu** (FinOps) → couverture PG non re-mesurée post-suspension | garder les chiffres geo marqués `[à consolider]` (mesures 28–29 juin) | `deploy/k8s/34/35*`, `zones-geo-30-investigation.md` |
| Comptage zonage canonique (task #92) | ~506 collections dont ~200 fragments ArcGIS ; ~234/1104, focus 3/30 | comptage zonage instable tant que non réduit à 1 collection/ville | `zones-geo-30-investigation.md`, `wp3-mapper-recall-2026-06-28.md` |
| Écart d'erreur completion Mistral vs OCR 4 sur grilles | conserver OCR 4 ; ne pas utiliser la completion en usage réglementaire tant que l'écart n'est pas mesuré et borné | risque de sur-vendre l'extraction structurée des grilles | brief utilisateur + état docs |
| Total graphes v2.3 exact (976 vs 978) | présenter une fourchette ~976–978 (mesure fraîche vs après publication saint-césaire) | fourchette assumée ; ne change pas la lecture (~88 %) | `2.3-completude-1105-FRESH.md`, `2.3-finition-progress.md` |
| Captures d'écran des vues pour la version présentée | à joindre sous `assets/` ; n'affectent aucun chiffre | slides et rapport lisibles sans images ; visuels = confort de présentation | brief §Artéfacts |
