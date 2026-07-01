# Blocages / points à confirmer

Aucun blocage bloquant pour une V1 du rapport.

## Points à consolider avant livraison finale

| Question | Hypothèse par défaut | Impact si non répondu | Source consultée |
|---|---|---|---|
| Couverture zonage exacte après jobs geo récents | utiliser les mesures juin : ~506 collections, ~234/1104, focus 30 ~3/30 | chiffres du rapport doivent rester marqués « à consolider » | `zones-geo-30-investigation.md` |
| État PG production après `populate-geo` daily | jobs k8s ajoutés mais non encore observés ici | impossible d'affirmer une couverture PG fraîche | manifests `35a/35b-populate-geo-*` |
| Métrique finale des 30 villes E2E | focus 30 utilisé comme banc de validation, mais couches pas toutes complètes | ne pas présenter les 30 comme complets | `2.3-finition-progress.md`, `wp4-produit-coverage.md` |
| Erreur comparative Mistral completion vs OCR 4 sur grilles | conserver OCR 4, mesurer la completion avant usage réglementaire | risque de sur-vendre l'extraction structurée des grilles | brief utilisateur + état docs |
