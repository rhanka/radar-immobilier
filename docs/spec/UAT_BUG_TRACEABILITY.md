# Traçabilité fine des bugs / UX UAT — radar-immobilier

> Vérifiée au code sur `main` (HEAD `e50d59c`), grain fin (1 ligne par sous-demande), posture
> **adverse** sur les « résolu » (la passe précédente sur-vendait : 24/28 ✅ annoncés vs réalité
> 28 ✅ / 9 🟡 / 2 ❌ après re-vérification). Tableau **Problème → Résolution → Statut**.

| Problème (verbatim court) | Résolution (fichier/commit) ou « NON FAIT » | Statut |
|---|---|---|
| [BR-05R] Acronymes : hover sur chaque acronyme, partout | `Acronym.svelte` + glossaire 12 termes (`b65af64`) MAIS câblé sur 3 composants seulement, pas d'auto-scan ; absent Opportunités/Automatisation/Onboarding/Jobs | 🟡 PARTIEL |
| [BR-05R] Tout en français | Définitions glossaire FR ; reste libellé « Reference » (anglais) dans `Acronym.svelte` + `GrillesView` | 🟡 PARTIEL |
| [BR-05R] Liens de référence dans descriptions d'acronyme | champ `url` (CPTAQ/OACIQ…) dans le tooltip `Acronym.svelte` (`b65af64`) | ✅ |
| [BR-05R] Matrice score 0-5 + traçabilité VISION | grille par axe + `ScoreHover` + réfs VISION §6 / PROCESS Étape 5 (`0c7dbe9`,`5b5cb1f`) | ✅ |
| [BR-05R] Insights réels par source (faisceau de preuve) | preuves par phase + lien Source + badge fait/hypothèse/N-D ; PAS de vue dédiée « contribution par source » | 🟡 PARTIEL |
| [S1] Story-telling / tour multi-étapes par écran | tour 24 étapes (`feat/demo-guided-tour`) JAMAIS mergé → absent de main | ❌ NON FAIT |
| [S1] « plus d'étapes par écran, expliquer chaque vue » | idem, pas de tour dans main | ❌ NON FAIT |
| [S1] « je ne vois aucune bulle jaune » | bulle d'aide ponctuelle `SignalsT1View` | ✅ (ponctuel) |
| [S1] Radar↔Opportunité côte à côte | nav verticale, jamais côte-à-côte (caduc, Radar supprimé) | 🟡 PARTIEL |
| [S1] clic sur l'un → voir l'autre | Approfondir → Opportunités filtré par signalId (`App.svelte`) | ✅ |
| [S1] opportunités au pluriel | `AppSidebar` « Opportunités » | ✅ |
| [S1] tous signaux → même opp @90 (bug affichage) | plus de "90" ; scores /100 ; signalId distincts (mapping 1:1, pas 1×N) | ✅ |
| [S1] marge droite de folie | cap max-w retiré, pleine largeur | ✅ |
| [S1] onglets navigables / push | nav AppSidebar ; mergé | ✅ |
| [S2] supprimer T0/T1/T3/T4 | copie nettoyée (`ff84484`,`8446450`) | ✅ |
| [S2] Onboarding.1 choisir la ville QC | Étape 1 Select municipalité, ville visible partout (`e3c7cb2`) | ✅ |
| [S2] Onboarding.2 « Construire/Qualifier » imbitable + cocher=rien | Switch + bénéfice clair + récap live (`e3c7cb2`) | ✅ |
| [S2] Radar.1 mapping 1×N / @90 non conforme | ancien Radar supprimé ; feed + dossiers signalId distincts (`8446450`) | ✅ |
| [S2] Radar.2 chat side-panel détachable, toutes vues | `RadarChatPanel` existe mais NON monté ; convenu → ÉV9 | ⏳ ÉV9 |
| [S2] Radar à supprimer | retiré du DemoView + nav | ✅ |
| [S2] Signaux.1 que 3/6 affichés | 6 signaux tous rendus (`fa9dcf6`) | ✅ |
| [S2] Signaux.1bis pas de score | Valeur /10 + barre + Confiance (`SignalRow`) | ✅ |
| [S2] Signaux.2 « hypothétiques » confus | badge « Exemple (simulation) » + bandeau | ✅ |
| [S2] Signaux.3 signaux vs radar | Radar supprimé, fil unique | ✅ |
| [S2] Comparaison gardée ici ? + critères non expliqués | fondue dans Automatisation, M1-M7 + méthode affichés | ✅ |
| [S2] Revue sources : activation incomprise | activation = Onboarding ; cadran+statuts+détail = Console | ✅ |
| [S2] Opportunités réel/sim aucune différence | `axesForMode` réel exclut hypothèses + plafonne + bandeau (`e6d2f86`) | ✅ |
| [S2] en réel : hypothèses supprimées ET dossier stoppé | axes exclus OK ; PAS de notion « dossier stoppé » | 🟡 PARTIEL |
| [S2] Grilles moches + illisibles | refonte 2 mesures + grille par axe (`0c7dbe9`) | ✅ |
| [S2] H2a difficile à comprendre | stub retiré du nav ; convenu → ÉV10 | ⏳ ÉV10 |
| [S2] Console T3/T4 abscons + rien cliquable | tabs FR + Drawer détail au clic (`828b59b`) | ✅ |
| [S2] tu mentionnes 6 cas, 3 affichés | 6 rendus | ✅ |
| [S2] séance d'alignement scoring↔VISION | décisions figées + réfs VISION/PROCESS | ✅ |
| [S2] passer à un score /100 ? | headline /100 + 0-5 en sous-texte | ✅ |
| [S3] interfaces flat / mono-colonne | app-shell dense + Opportunités master-detail (`3c86b83`,`ac6c862`) | ✅ |
| [S3] redondance cadran ↔ console | cadran fusionné dans Qualification (`5b5cb1f`) | ✅ |
| [S3] redondance rapport agents | fondu dans Automatisation | ✅ |
| [S3] rien d'automatisé / live | stubs étiquetés ; convenu → ÉV11 | ⏳ ÉV11 |
| [S3] je vois encore T0 | strip complet, 0 occurrence (`ff84484`) | ✅ |
| [S3] opportunités empilées : sélection/accordéon | master-detail liste+détail (`ac6c862`) | ✅ |
| [S3] sous-éléments ≥ 2 colonnes | phases en `grid-cols-2` (`DossierCard`) | ✅ |
| [S3] 100% design system | Opportunités migré DS ; Signaux/Console/Automatisation/Onboarding encore Tailwind brut | 🟡 PARTIEL |
| [S3] « du non-réel dans le réel » | `axesForMode` corrige les AXES ; mais `filterRealMode` ne filtre PAS les evidence `hypothese` en réel → preuves hypothèses encore visibles | 🟡 PARTIEL |
| [S3] pas démarré / bonne branche ? | mauvais worktree bind-monté ; ré-monté (process) | ❔ caduc |
| [S3] je ne vois pas la traçabilité | ce document (au grain fin) | ✅ |

## Décompte (43 items) : ✅ 28 · 🟡 9 · ❌ 2 · ⏳ 3 (ÉV9/10/11) · ❔ 1

## 🚫 Bloquant UAT — non résolu (à traiter)
1. **❌ Tour guidé / story-telling multi-étapes** (demandé 2×, jamais mergé)
2. **🟡 Acronymes « partout »** — câblés sur 3 vues seulement
3. **🟡 « du non-réel dans le réel »** — `filterRealMode` ne retire pas les evidence `hypothese` en mode réel
4. **🟡 100% design-system** — Signaux/Console/Automatisation/Onboarding encore en Tailwind brut
5. **🟡 « dossier stoppé » en réel** — non implémenté
6. **🟡 Insights/valorisation par source** — vue de contribution par source absente
7. **🟡 Français** — libellés « Reference » anglais résiduels
8. **🟡 Radar↔Opp côte-à-côte** — largement caduc (Radar supprimé) ; à confirmer comme abandonné
