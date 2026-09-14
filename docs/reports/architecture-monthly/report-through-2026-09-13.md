# Rapport architecture — 10 août → 13 septembre 2026

Statut : rapport D9. Ce document n'est ni une facture fournisseur, ni une
acceptation de promotion en production. La fenêtre America/Toronto est
`2026-08-10T00:00:00-04:00` incluse à
`2026-09-14T00:00:00-04:00` exclue : **35 jours / 840 heures**.

## 1. Jointure et portée historique

Le rapport précédent est joint à la fin du PDF et embarqué sans modification
comme `study-2026-08-report.pdf`. Sa source exacte est
`docs/spec/reports/study-2026-08/report.pdf`, SHA-256
`86ae37810016bca61cc897105121cfcbcd1951426fc889616ae1efe37ae29528`,
localisée au commit historique `72b966664523801ea00cfcb704e0285ee765c136`.
Ce commit sert de localisateur : aucune appartenance à `main` n'est affirmée.

La reconstruction du 9 août utilise la dernière révision documentaire
first-parent de `main` avant la fin de cette journée. Une déclaration Git n'est
pas transformée en inventaire runtime. Les reçus du 13 septembre sont ancrés
sur leurs révisions complètes et leurs heures d'observation.

## 2. Deux transitions autonomes, quatre scènes

Les quatre Mermaid de `docs/architecture.md` sont la source canonique. Le Focus
les rend aussi sous forme de quatre SvelteFlow natifs : boîtes `parentId`
imbriquées, sous-flux, icônes, états, relations et provenance `repo:`. Les
identifiants, projections et SHA-256 de scène sont partagés par le HTML, le PDF
et le manifeste de preuve.

| Paire | 9 août — AVANT | 13 septembre — APRÈS |
| --- | --- | --- |
| A · production | MinIO applicatif; coordonnées et registre SCW déclarés; miroir GHCR non attesté | OVH S3 et GHCR sur les chemins applicatifs; MinIO absent du runtime observé; **SCW TEM explicitement conservé** |
| B · refresh | collecte, extraction et projection lancées depuis le poste; CronJobs suspendus | CronJob causal intégré et accepté en préproduction; **production dormante jusqu'à promotion**; **modèle en attente de M1** |

Le cutover A est observé à 23:39Z. Restent ouverts la parité des attributs de
destination, le rescan final de la source et le balayage global des dépendances
historiques. Aucune cible mono-nœud n'est présentée comme runtime observé.

Pour B, le corpus PV et le graphe publié restent neutres vis-à-vis du
fournisseur. L'acceptation préproduction porte sur un trial Luna high, un
Signal/PDF Waterloo, le rejeu exact et un Job créé par le contrôleur. Elle ne
sélectionne pas Luna low et n'active pas la production.

## 3. Décision M1 encore ouverte

M1 compare exactement `sonnet-comparable`, `luna-low` et
`gemini38-lowest` sous le même corpus, prompt, schéma, politique de retry et cap
de sortie. Le jeton Sonnet demeure sous contrôle propriétaire, monté en lecture
seule et absent du dépôt, des arguments, des logs, des commits et du PDF.

La tentative Gemini historique sans sortie est **non classable**. Elle ne
constitue ni résultat, ni score, ni rang. Aucun gagnant n'est disponible et le
modèle de production demeure `null` jusqu'au benchmark apparié, au jugement
indépendant et à la ratification propriétaire.

## 4. Coûts de la fenêtre

### Infrastructure

Projection de référence demandée : un b3-8 BHS5 au tarif repris de
`0.082 CAD/h` :

`1 × 840 h × 0.082 CAD/h = 68.88 CAD`.

Cette valeur est une projection, pas une mesure de consommation. Les coûts de
plateforme à deux ou trois nœuds sont exclus.

### LLM

L'audit local dédoublonné conserve la méthode d'allocation de capacité par
abonnement du rapport précédent. Il produit **139.337732 CAD** pour Immo et
**111.877705 CAD** pour Geo, soit **251.215438 CAD**. Cette allocation est
**provisoire, non critique et non finale**; elle n'est pas une ligne de facture
et ne bloque ni l'architecture ni les promotions.

| Poste | Montant CAD | Qualification |
| --- | ---: | --- |
| Projection infrastructure | **68.880000** | cible indicative |
| Allocation LLM Immo + Geo | **251.215438** | provisoire, non critique, non finale |
| **Somme indicative** | **320.095438** | non facturée |

## 5. Rejeu et limites

- Les preuves datées ne certifient pas les faits absents de leurs reçus.
- SCW TEM reste l'exception email autorisée jusqu'à remplacement validé; dans
  la paire B, il demeure hors du chemin d'extraction PV.
- Le PDF contient d'abord ce rapport et les quatre graphes complets, puis les
  neuf pages du rapport précédent; l'original est aussi extrait et vérifié par
  SHA-256.
- Chromium est contrôlé à zoom 100 %, facteur de pixels 1. Les captures
  complètes agrandissent la toile sans réduire le graphe.

Rejeu documentaire :

```sh
make -f docs/architecture/focus/Makefile test build browser report-check ENV=test-architecture-two-transitions
```
