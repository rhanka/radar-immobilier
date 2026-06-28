# Geo propriétaires de lots — acquisition contrôlée, Loi 25, auth et avertissement scraping

Date: 2026-06-27
Décideur: rhanka / utilisateur projet

## Décision

La donnée **propriétaire de lot** est transférée côté **geo** plutôt que portée par
`frontA-data`.

Cette donnée reste utile pour l'évaluation immobilière, mais elle doit être traitée
comme donnée d'accès contrôlé et non comme attribut public banal de carte.

## Conditions de scraping / acquisition

- L'accès à la donnée doit respecter les conditions de la source consultée.
- L'utilisateur doit recevoir un avertissement explicite avant tout scraping ou
  toute consultation automatisée d'une source pouvant être protégée par conditions
  d'utilisation, anti-bot, captcha ou accès authentifié.
- Les flux captcha / Obscura / registre foncier / rôle foncier ne doivent pas être
  exécutés silencieusement en tâche de fond sans posture documentée.

## Stockage et accès

- Déclaration Loi 25 à prévoir pour le stockage et le traitement des propriétaires
  de lots.
- Accès authentifié obligatoire, y compris côté geo.
- Séparer la donnée propriétaire des couches publiques lots/zones/signaux.
- Journaliser provenance, date d'accès, source, finalité et utilisateur/processus
  ayant déclenché l'accès.
- Prévoir masquage ou non-retour par défaut dans les APIs publiques / démo.

## Impact Track

- L'ancien item `frontA-data` A.2.5 n'est plus à implémenter tel quel côté immo.
- Un nouvel item côté `frontB-geo` doit porter l'acquisition, le stockage contrôlé,
  les garde-fous Loi 25/auth et l'UX d'avertissement.
