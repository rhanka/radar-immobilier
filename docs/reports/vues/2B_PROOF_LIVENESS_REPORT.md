# #2b — Balayage de vivacité des preuves servies (rapport vues)

**Date** : 2026-08-08. **Demande** : conducteur (`2b-rendered-proof` / `2b-25-focus`) — « jamais servir une preuve 404 nu ». Mesurer la vivacité (200 vs 404/mort) des URLs de preuve servies, et confirmer que l'UI dégrade vers l'archive quand une URL publique meurt.

**Source de données** : `PROOF_URLS_SERVED.json` (recette, extrait via le VRAI `isPublicCanonicalUrl` servi `b4b351dae`) — 2893 sourceUrl, avec par preuve `type`, `subtype`, `a_un_archive_S3`, `rawRef`.

## Répartition mesurée (recette, 2893 sourceUrl)

| classe | n |
|---|---:|
| public-source | 2713 |
| — object-storage-public (VPlus + sites muni, re-autorisés #2b) | 554 |
| — clean (domaine muni) | 2159 |
| archive-rawRef (`s3://`) | 170 |
| rejected (garde signature/anti-injection) | 10 |
| **avec repli archive (`rawRef` présent)** | **2868 / 2893** |
| **SANS repli archive (orphelines)** | **25 / 2893** |

Le chiffre décisif : **2868/2893 preuves ont un `rawRef`** → un lien public mort peut retomber sur `/api/documents/raw?rawRef=…` (archive same-origin, jamais une URL S3 signée). Seules **25 preuves orphelines** (public-source, sans `rawRef`) pourraient être un 404 nu si l'URL publique mourait.

## Mesure de vivacité (fetch HTTP, HEAD→GET, timeout, poli)

### Les 25 orphelines (le seul vrai risque de 404 nu) — PRIORITÉ conducteur
16 URLs uniques (dédupliquées des 25) fetchées le 2026-08-08 :

| statut | n (URLs uniques) |
|---|---:|
| **200** | **16** |
| 3xx | 0 |
| 404 / mort | **0** |

**⇒ 0 preuve orpheline morte. 0 risque de 404 nu mesuré aujourd'hui.** Villes concernées (toutes 200) : mont-saint-gregoire, saint-roch-ouest, saint-edouard, brigham, lile-cadieux, saint-liguori, oka, saint-lambert.

### Échantillon des 554 object-storage-public (re-autorisés #2b)
10 URLs échantillonnées (VPlus + saintamable + saintbruno + valdesmonts + ville-mont-joli OVH) : **10/10 = 200**. Les preuves publiques re-autorisées sont vivantes.

## Comportement UI du repli (mesuré / prouvé)

- **2868 preuves avec `rawRef`** : l'UI (SignauxSelPanel) rend DEUX liens côte à côte — le lien de preuve **direct** (URL publique) ET le lien **archive** same-origin `/api/documents/raw?rawRef=…`. Les deux sont rendus + s'ouvrent réellement (prouvé en vrai navigateur par l'e2e PR #492). ⇒ une preuve n'est **jamais « nue »** quand `rawRef` existe : l'archive fiable est toujours cliquable à côté du lien public.
- **Nature du repli** : c'est un repli **MANUEL** (les deux liens présents), PAS une redirection **automatique** au 404. Le client ne peut PAS sonder la vivacité d'une URL externe avant le clic (CORS bloque le probe cross-origin). Le lien direct, cliqué alors qu'il est mort, ouvre un 404 dans le nouvel onglet — mais le lien archive est juste à côté.
- **25 orphelines (sans `rawRef`)** : seul le lien direct est rendu. Toutes 200 aujourd'hui → pas de 404 nu. Risque résiduel = mort future d'une orpheline (pas d'archive de repli).

## Conclusion

**Portée de la mesure (précise, à ne pas sur-lire)** : le fetch est **EXHAUSTIF sur le JEU À RISQUE** — les 25 orphelines (16 URLs uniques), seul vecteur possible de 404 nu — plus un **ÉCHANTILLON de 10/554** object-storage-public. Ce n'est **PAS** un balayage exhaustif des 2893 : les 2868 preuves avec repli archive ne sont pas toutes fetchées. Ce n'est pas nécessaire — leur risque de 404 nu est **borné par le repli archive** (`rawRef` → `/api/documents/raw`), donc non-critique (confirmé par recette).

- **0 preuve morte sur le jeu à risque** (25 orphelines exhaustif = 100% 200) **+ échantillon public** (10/10 = 200). PAS « 0 morte sur 2893 ».
- **0 risque de 404 nu aujourd'hui** : le seul vecteur (orpheline-sans-archive) est vérifié exhaustivement vivant.
- **2868/2893 (99,1%)** ont un repli archive same-origin toujours présent à côté du lien public → même une mort future y retombe (jamais un 404 nu).
- Invariant sécurité tenu (recette) : **0 URL signée exposée**.

## Recommandations (au conducteur — pour durcir au-delà du mesuré)

1. **Mesure continue** : re-jouer ce balayage périodiquement (cron/CI planifié) — c'est une mesure de données, hors composant UI.
2. **Repli automatique au 404** : impossible en client pur (CORS interdit le probe cross-origin). Deux voies si l'owner le veut : (a) check de vivacité **côté serveur** (`api/`, hors scope vues) qui annote chaque preuve `live: bool` → l'UI masque/priorise ; (b) choix UX : **préférer le lien archive same-origin par défaut** quand `rawRef` existe (fiabilité) vs garder la source canonique publique en tête (traçabilité) — à trancher owner.
3. **Éliminer le dernier risque orphelin** : scraper→archiver les 25 orphelines (leur donner un `rawRef`) → 100% des preuves auraient un repli. Tâche extraction/geo, hors vues.

Aucune de ces trois n'est un bug UI bloquant : l'état mesuré est sûr (0 mort, 0 nu, repli présent sur 99,1%). Les liens `rel="noopener noreferrer" target="_blank"` (anti-XSS) et la garde signature-based (0 signée exposée) sont en place.
