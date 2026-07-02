# Rapport d'étude — demandes de révision (principal, 2026-07-02)

> Tracking des retours du principal. **Ne pas re-présenter le rapport tant que la
> partie « 1 — Faisabilité data » n'est pas CONSOLIDÉE** (consigne explicite).
> Statut : ☐ à faire · ◐ en cours (données externes) · ☑ fait.

## R1 — Séparer PV et Signaux (couches distinctes) ☐
Le graphe **n'est pas la finalité**, c'est la **méthode de parsing** du signal.
Dans la table Focus-30/1104 et partout : **une ligne PV scrapé (recueil brut)**, **une
ligne Signaux (extraits via graphify v2.3)**. Ne plus présenter « graphe présent » comme
une couche-résultat.
- Chiffres focus-30 mesurés : PV scrapé **27/30** (brossard/kirkland/lile-dorval = 0 brut) ;
  Signaux v2.3 **25/30** (saint-constant, saint-philippe encore v2.2).
- Province : ~97 villes sans brut → PV ≈ **~1007/1104** ; Signaux v2.3 **978/1104**.

## R2 — Grounding = 100 % attendu + passe de cleansing ☐
Un signal non groundé **n'existe pas**. Ne plus écrire « 56/70 = 80 % groundés » comme si
80 % était OK : présenter comme **dette de qualité** → **passe de cleansing** (purger ou
re-grounder les ~14/70 non-groundés). Cible = **100 % groundé**.

## R3 — Introduire v2.2 / v2.3 + quantifier (client-facing, complet) ☐
Les versions d'ontologie **v2.2** et **v2.3** ne sont **définies nulle part**. Le rapport est
**client-facing** → introduire clairement ce que sont v2.2 / v2.3 (ce que v2.3 ajoute :
grounding verbatim/citation obligatoire, gates), et **quantifier** (pas d'« approximatif » :
donner les nombres exacts par dimension et par périmètre).

## R4 — Annexe « consistance signaux » : résultat final, pas le détail entassé ☐
La ligne d'annexe « graphe 27/30 · v2.3 25/30 · signaux 70 · groundés 56/70 · … » est
illisible : mettre **le résultat final** propre (une ligne = un indicateur), pas tout dans
une cellule.

## R5 — Sources zonage en plusieurs lignes ☐
Décomposer la couche zonage par **méthode d'acquisition**, une ligne chacune :
- **ArcGIS**
- **GeoNet** (à confirmer nom exact)
- **(3ᵉ source — probable CKAN / Données Québec — à confirmer avec geo)**
- **PDF** (recalage géoréférencé)
Avec, par méthode, la proportion / le nombre de villes couvertes (à consolider avec geo).

## R6 — Infra & coûts : consolider avec agent-stats + k8s ◐ (données externes)
Le paragraphe infra/coûts doit être **compatible avec les demandes de facturation** faites
côté **agent-stats** et **k8s**. Présenter distinctement les coûts **immo** ET **geo (dont
geo-quebec)**. → Demandes h2a envoyées à agent-stats (tokens/coût immo), poc-k8s (coût
infra cluster), geo (coût geo + geo-quebec). **En attente de leurs chiffres réels.**

## R7 — « Mixture of AGENTS » + consensus (pas « experts ») ☐
Renommer 3.B « Utilisation de l'IA : **mixture of agents** ». Le cœur = l'usage du
**consensus** multi-agents (double-relecture, vérification adverse, arbitrage par plusieurs
agents 4.8xhigh + codex 5.5xhigh) pour les problèmes complexes. Pas « experts ».

## R8 — Consolidation générale ◐
« 1 — Faisabilité data » doit être **consolidée avec geo** avant re-présentation. Retirer les
« à consolider » là où on a la vraie mesure ; ne garder « à consolider » que sur ce qui
attend vraiment une donnée externe (coûts, 3ᵉ source zonage, chiffres geo-quebec).

## Données externes attendues (h2a)
- **geo** : couverture zonage par méthode (ArcGIS/GeoNet/CKAN/PDF) × (focus-30 / 1104) ;
  chiffres geo-quebec ; coût geo + geo-quebec.
- **agent-stats** : coût/tokens immo (siège vs complet), compatible facturation.
- **poc-k8s** : coût infra cluster radar (+ geo si porté).
