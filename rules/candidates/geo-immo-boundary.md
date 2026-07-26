---
description: "Frontière obligatoire entre le référentiel geo et la sémantique immo"
alwaysApply: true
paths:
  - "**/*"
---

# Frontière d'autorité geo/immo

## Règle d'autorité

`geo` est l'unique référentiel de données. Il possède l'acquisition, le scraping, les octets bruts, l'OCR et le texte dérivé, le stockage, les versions, la preuve et la citabilité des sources géospatiales et documentaires.

`immo` possède la sémantique métier. Il produit les détections et relations avis de motion → règlement → zonage, l'ontologie temporelle, les signaux, les événements de désignation, le vivier et le scoring.

`immo` consomme les contrats de `geo`. Il ne duplique pas le référentiel et ne devient pas une seconde source de vérité sur les données.

Les labels, résumés et classifications produits par `immo` sont des objets sémantiques. Les octets, textes OCR et extraits verbatim de la source restent des données `geo`.

## Obligations de production et de consommation

- `geo` découvre, collecte et archive toutes les sources, y compris PV, avis publics et règlements.
- `geo` publie des contrats en lecture seule, versionnés, hachés et citables : manifestes, objets immuables, API et artefacts dédiés.
- `immo` épingle la version et le hash de chaque entrée geo utilisée par un traitement sémantique.
- `immo` persiste ses entités et relations métier avec des références de preuve vers geo. Il ne persiste aucune copie durable des octets, textes, géométries ou faits geo ; un cache éphémère éventuel est vérifié par hash et ne permet jamais le replay seul.
- `geo` n'écrit jamais dans `graph_nodes`. Le graphe sémantique et son projecteur atomique appartiennent à `immo`.
- Aucun composant n'accède directement aux tables privées de l'autre domaine. Tout échange passe par un contrat publié.

Le code actuel qui scrape ou archive des sources brutes dans `immo`, ou qui copie des données geo dans ses tables, est une dette de migration. L'agent ne doit pas l'utiliser comme précédent architectural ni étendre cette duplication.

## Composition et homonymes

Une vue composée préserve séparément la provenance et l'autorité de chaque champ.

- `geo Zone.usage_dominant` décrit une zone.
- `immo Signal.usage_dominant` décrit le dossier municipal détecté.
- `geo Zone.effet_densifiant` décrit un fait calculé pour une zone.
- `immo Signal.effet_densifiant` décrit l'interprétation métier, sourcée, de l'effet d'un dossier.
- Un delta de grille ou de norme factuel est produit par `geo`.
- La qualification de ce delta comme effet métier d'un signal est produite par `immo`.

L'agent ne copie, ne renomme ni ne déduit implicitement une valeur entre ces espaces de noms.

## Obligation de l'agent

Avant toute évolution qui touche des données geo ou immo, l'agent identifie explicitement :

1. le propriétaire de la donnée ou de la sémantique ;
2. le producteur ;
3. le consommateur ;
4. le contrat et le canal versionnés ;
5. la preuve et les règles de rejouabilité.

Si un document ou le code contredit cette règle, la règle prévaut. L'agent signale le document ou le composant comme en retard et propose une migration ; il ne résout jamais la contradiction en faveur de l'état historique.

Une modification qui change l'autorité, un contrat inter-domaines, une clé de jointure, une politique de rétention ou un canal de publication exige une décision explicite des propriétaires concernés avant implémentation.
