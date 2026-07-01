# Brief — Rapport d'étude Radar Immobilier (2026-07)

## Objectif
Livrer un rapport d'étude sur ce qui a été réalisé, sous forme :
- Markdown source,
- images intégrées,
- slides HTML,
- PDF consultable au sein de l'application.

## Périmètre demandé

### 1. Faisabilité data — à consolider avec geo

#### A. Synthèse
1. Focus 30 villes pour toutes les couches et E2E : consistance signaux.
2. Potentiel cible sur les 1104 municipalités : projection vs effectif déjà fait.
3. Limites signaux/préconisations :
   - jobs récurrents,
   - optimisations,
   - modèle optimisé pour la détection des signaux,
   - mapping rues / zones.

#### B. Détail par layer
1. Zonage : méthode et proportions projetées : ArcGIS, Geo*, PDF ; limites potentielles des données.
2. Grilles d'évaluation : écart / erreur Mistral completion ; conserver Mistral OCR 4.
3. Lots, cadastre et données PII.
4. Détection des signaux : méthode graphify / entités.

### 2. Réalisations fonctionnelles
1. Vue géographique : ville, zones, lots, limites actuelles.
2. Signaux : filtrage, citations, affichage.
3. Vue données : consolidation.

### 3. Code et intégration
1. Code généré et architecture générale : architecture des librairies, réversibilité des couches OAuth ; ne pas insister sur les couches transverses ni mentionner d'open-source.
2. Utilisation IA : mixture of experts pour résolution des problèmes complexes, doubles comptes 4.8xhigh et Codex 5.5xhigh.
3. Infrastructure : bref — k8s, CDN, etc. Projection des coûts/tokens : sensibilisation coût au siège vs coût complet.

## Contraintes de rédaction
- Ton étude / livraison client.
- Être honnête sur effectif vs projeté.
- Ne pas masquer les limites : PV hard-scrape, couverture PG vs geo live, jobs récurrents, mapping rues/zones, qualité signaux.
- Consolider avec l'état geo quand disponible.
- Ne pas mentionner explicitement que certaines briques sont open source ; parler d'architecture modulaire et réversible.

## Artéfacts attendus proposés
- `docs/spec/reports/study-2026-07/report.md`
- `docs/spec/reports/study-2026-07/slides.html`
- images sous `docs/spec/reports/study-2026-07/assets/`
- option intégration app : route/asset PDF à définir après validation du contenu.

## Mécanisme de blocage attendu pour l'agent
Si un détail manque, écrire une note courte dans :
- `docs/spec/reports/study-2026-07/BLOCKERS.md`
avec :
- question,
- hypothèse par défaut,
- impact si non répondu,
- fichier/commande consulté.
