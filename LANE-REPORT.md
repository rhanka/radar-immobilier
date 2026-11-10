# Lane report — artifact mockup « focus signal »

- Branche : `artifact/p/bbfae795/focus-signal-h203`
- Commit : `5bfb9624bf0c4c59f1ac78df27ec6bde1822277c` (« feat(artifact): focus-signal panel with real-data valuation cases », aucun trailer d'attribution IA)
- Base : `preview-combo` @ `a89a3cc9` (inclut `c9960f7a`, version UI validée)
- Push : effectué vers GitHub (`rhanka/radar-immobilier`) via le dépôt local classement. Aucun push vers `main`, aucune PR, aucun appel MCP de publication.

## Ce qui est livré

- `SignalFocusPanel` : au clic d'un signal focalisé, panneau dans la moitié haute de la zone centrale (au-dessus de la carte, moitié basse). Rail gauche et cartes de droite inchangés. La carte conserve la mécanique de surlignage zones/lots du signal focalisé déjà présente dans la base (`focusedSignalZoneRefs` / `focusedSignalLotRefs`).
- Sections : signal + preuve (extrait de PV), règlement associé (avant réel → après lu dans le PV), zone associée, lots associés (survol synchronisé panneau ↔ état carte), valorisation avec section « Comment c'est calculé ».
- Harnais QA `focus-signal` pour les captures locales.

## Cas choisis (données réelles uniquement, amendement du 09/11)

1. Longueuil — signal `sig-longueuil-001`, règlement CO-2026-1187, zone H-203, lots 6 359 591 (lien produit réel) et 6 359 612 (même zone). Pertinent : avis de motion avec gabarit explicite dans le PV (« multifamiliale jusqu'à 4 étages », point 7.3), deux lots réels desservis dans la zone.
2. Salaberry-de-Valleyfield — signal `sig-valleyfield-001`, PPU-2026-007, zone H-410, lot 5 870 223 non desservi. Pertinent comme contre-cas : adoption conditionnelle aux services, valorisation en source-gap plutôt qu'un montant inventé.

## Réel vs incorporation simulée

- Réel (MCP immo preprod, lecture seule, 2026-11-09) : signaux, étapes, dates, règlements, zones, lots, superficies, façades, usages, desserte, extraits de PV.
- Réel (source publique citée) : prix médian condominium Le Vieux-Longueuil 398 500 $ (Centris, consulté le 2026-11-09).
- Incorporation simulée (badgée dans l'UI) : rattachement du lot 6 359 612 au signal (règle : même zone), application du gabarit du PV aux lots, valorisation.
- Source-gaps affichés, jamais comblés : grille CES/COS H-203 et H-410 (source publique identifiée : grilles de spécifications, Ville de Longueuil, Données Québec), prix Valleyfield, géométrie des lots dans le harnais.

## Formules (inspiration LotAI)

- Surface brute (borne haute, empreinte pleine faute de grille) = superficie du lot × étages autorisés après.
- Logements théoriques = surface brute × 80 % (rendement net, hypothèse affichée) ÷ 85 m² (logement moyen, hypothèse affichée).
- Valeur indicative = logements × prix médian public cité.
- Résultats H-203 : lot 6 359 591 → 46 logements, 18 331 000 $ ; lot 6 359 612 → 74 logements, 29 489 000 $ (bornes hautes théoriques, libellées comme telles).

## Sources LotAI

- GetApp — LotAi (plateforme québécoise, 4,4 M de lots, 31 sources publiques, constructibilité et zonage croisés) : https://www.getapp.com/all-software/a/lotai/
- Capterra — LotAi (analyse de lots, zonage, constructibilité) : https://www.capterra.ca/directory/31244/commercial-real-estate/software
- Rapport interne `docs/reports/benchmark-lotai-dossier-decision-2026-11-03.html` : présent dans la base ; son contenu est un bundle applicatif illisible en texte brut dans cette lane (constat, non exploité ligne à ligne).

## Build et captures

- Build artefact : `npm ci --workspace=ui --workspace=packages/radar-domain --workspace=packages/radar-scoring --workspace=packages/radar-sources` puis `npm run build:artifact` dans `node:24 --memory=1536m` : vert (avec `NODE_OPTIONS=--max-old-space-size=1024` ; sans ce cap, OOM du conteneur constaté). Pic RSS du processus client mesuré : ~26 Mo (mesure externe, le pic interne au conteneur reste sous le cap de 1536 Mo puisque le build passe).
- Typecheck : aucune erreur sur les fichiers livrés (les erreurs restantes proviennent de l'install subset, dépendances `api` absentes : `hono`, `drizzle-orm`).
- Captures (Chrome CDP 9333, harnais local, regardées) : `shots/01-liste-signaux.png`, `shots/02-focus-signal-h203.png`, `shots/03-valorisation.png`, `shots/04-survol-lot-carte.png`, `shots/05-focus-valleyfield-sourcegap.png`.
- Limite des captures : les tuiles OSM externes ne chargent pas depuis le Chrome sandboxé (pas d'accès réseau sortant du navigateur) ; la carte du harnais reste blanche avec son libellé source-gap. En artefact réel, le fond de carte est servi par l'hôte (`/__artifacts/tiles/v1`) et le surlignage zones/lots utilise les couches géo réelles.
