# SPEC_EVOL — ÉV8 Recadrage démo : parcours & UX (cohérence)

> **Status**: EVOL — recadrage de la démo Phase 1 après UAT (feedback humain 2026-05-27).
> Le drumbeat ÉV1–ÉV7 a livré la **largeur** (10 vues, tests verts) mais **deux générations de
> vues coexistent** (ancienne démo « score 90 » : Radar/Comparaison/Revue-sources ; nouvelle
> honnête : Onboarding/Signaux/Opportunités/Grilles/Coordination/Console/Automatisation) → le
> **parcours n'est pas lisible**. Cette spec recadre : un flux unique, consolidation des vues,
> registre des bugs, et **deux séances dédiées** (scoring↔VISION, h2a) qui gatent leurs reworks.
> **Pas d'implémentation autonome de masse** : on procède vue par vue, UAT à chaque étape.

## 1. Problème (constat UAT)
- 10 onglets sans fil narratif ; jargon interne T0/T1/T3/T4 affiché.
- Vues obsolètes (données bidon) coexistant avec le modèle honnête → **contradictions** (ex. Radar
  affiche 1 signal → 1 opportunité @ score 90, alors qu'Opportunités affiche 1→N, 0-5, partiel/plafonné).
- Fonctions convenues non honorées : **chat global side-panel**, **choix de la ville**, **réel/sim
  qui change réellement l'affichage**, **1→N réellement montré**.

## 2. Flux cible (un seul fil, pour une municipalité)
1. **Onboarding** — choisir une **ville du Québec** → configurer **quelles sources scanner** → lancer
   (rétro-analyse 2 ans + scan quotidien).
2. **Signaux** (le « radar ») — les documents scannés produisent des **signaux** (rezonage, CPTAQ,
   PPCMOI…), triés par **type (valeur /10)** + **confiance** + **statut**. *Une seule vue.*
3. **Opportunités** — « Approfondir » sur un signal → il **se décline en N lots/dossiers** ; chacun
   scoré via les 6 phases (0-5, partiel, plafonné si preuve manquante).
4. **Grilles de score** — la **grille de notation** (référence/config), pas une étape.
5. **Coordination + chat** — l'humain (PRINCIPAL) décide, l'IA assiste sous POLICY ; décisions
   journalisées ; **chat = panneau latéral global**.
6. **Console / Automatisation** — exploitation : santé sources + jobs ; cadence ; **benchmark agents**.

## 3. Consolidation cible (10 onglets → ~5 vues + 1 chat global)
| Vue cible | Action |
|---|---|
| **Onboarding** (ville → sources → lancer) | reçoit l'activation des sources |
| **Signaux** (feed unique) | **supprime l'ancien Radar** + `radar-demo-data` (score 90) |
| **Opportunités** (1→N, funnel, scoring honnête, réel/sim effectif) | cœur du produit |
| **Grilles de score** (refonte lisible) | **GATÉ par la séance scoring↔VISION (§6)** |
| **Console** (sources + jobs, sans jargon) | **absorbe Revue des sources** |
| **Automatisation** (cadence + benchmark expliqué) | **absorbe Comparaison des agents** |
| **Chat / Coordination** = **panneau latéral global** (chat-ui sentropic, intégré aux outils) | sort de l'onglet ; **rework gaté par le brainstorm h2a (§6)** |

## 4. Registre des bugs / feedback (UAT 2026-05-27)
| # | Vue | Constat | Verdict | Action |
|---|---|---|---|---|
| G1 | global | Jargon T0/T1/T3/T4 affiché | UX | Retirer de l'UI (garder en doc) |
| ON1 | Onboarding | Pas de choix de ville ; on ne sait pas de quelle ville on parle | 🔴 manque | Sélecteur **municipalité QC** en 1ʳᵉ étape (Salaberry pré-rempli en démo), puis config |
| ON2 | Onboarding | « Construire / Qualifier l'accès » imbitable ; cocher ne fait rien | 🔴 UX | Refondre en « activer/désactiver source pour cette ville », langage clair ; la sélection **configure le scan** |
| RA1 | Radar | Tous les signaux → 1 opportunité @ score 90 | 🔴 non-conforme (ancienne vue) | **Supprimer** l'ancien Radar ; le modèle 1→N honnête vit dans Opportunités |
| RA2 | Radar | Pas de chat global side-panel/détachable | 🔴 non-conforme | Chat global (voir CH1) |
| RA3 | Radar | Faut-il le supprimer ? | ✅ oui | Supprimer ; **Signaux** est le feed unique |
| SI1 | Signaux | **6 signaux en données mais seuls 3 affichés** | 🔴 bug | Le mode réel par défaut masque les 3 `simulation` → afficher les 6 (avec badge), ou repenser les synthétiques ; rendre le compte explicite |
| SI2 | Signaux | « signaux hypothétiques » confus | 🟠 | Marquer explicitement « exemple/simulation » ou retirer les synthétiques |
| SI3 | Signaux | Signaux vs Radar incompris | ✅ même concept | Fusion (RA3) |
| SI4 | Signaux | Pas de score visible | 🟠 clarif | Un signal a **valeur /10 + confiance** (PAS un score /5 — ça c'est l'opportunité). Rendre lisible |
| CMP1 | Comparaison | Toujours là ; critères (M1–M7) non expliqués | 🟠 | **Fusionner dans Automatisation** + documenter les critères in-view |
| SRC1 | Revue sources | Articulation / activation incomprise | 🟠 | **Fondre dans Console** ; l'**activation** devient un acte de l'Onboarding |
| OP1 | Opportunités | Bascule réel/sim : aucune différence | 🔴 | **Sémantique** : réel = masquer/neutraliser hypothèses + non-disponible, dossier sans preuve clé → « surveillance / en attente de preuve » ; simulation = montrer la cible. Rendre visible |
| GR1 | Grilles | Moche + illisible | 🟠 design | Refonte + clarifier 2 mesures (tri /10 vs score 0-5), grille par axe, non-disponible→renorm+plafond — **GATÉ §6** |
| H2A1 | Coordination | Difficile à comprendre, hors-sol | 🟠 | Ancrer dans le flux (chat global + journal des décisions sur opportunités) — **GATÉ §6 (brainstorm)** |
| CO1 | Console | Références « T3/T4 » absconses | 🔴 | Retirer le jargon |
| CO2 | Console | Rien n'est cliquable (stubs statiques) | 🔴 | Interactivité réelle, ou cadrage explicite « monitoring (démo) » |

## 5. Spéc des reworks par vue (non gatés — peuvent démarrer)
- **Onboarding** : étape 1 = sélecteur municipalité QC (liste réelle ou échantillon ; Salaberry par
  défaut) ; étape 2 = sources activables (langage clair) ; « Lancer » récapitule la config (démo).
- **Signaux** (= ex-Radar) : une vue, **affiche les 6** (badge `simulation`), valeur /10 + confiance
  + statut lisibles, tri valeur/confiance séparé, « Approfondir » → Opportunités filtré par signal.
  **Supprimer** `radar-demo-data`/ancien Radar/AppShell-signal-90.
- **Opportunités** : implémenter la **sémantique réel/sim** (OP1) — réel masque hypothèses +
  plafonne, simulation montre la cible ; le toggle global change réellement le rendu.
- **Console** : absorbe Revue sources (qualif + santé) + jobs ; sans jargon ; cliquable a minima
  (sélection source → détail ; job → détail) ou cadrage « démo ».
- **Automatisation** : absorbe Comparaison ; explique les critères de benchmark (M1–M7).
- **Chat global (CH1)** : réutiliser **le ChatPanel `@sentropic/chat-ui` tel quel** (comme
  `RadarChatPanel`), en **panneau latéral détachable accessible de toutes les vues**, **intégré aux
  outils du radar** (catalogue d'outils : interroger signaux/opportunités/sources…). Remplace le
  chat-stub ÉV5.

## 6. Séances dédiées (GATES — ne pas trancher en autonomie)
- **S1 — Alignement scoring ↔ VISION** : session de présentation/alignement du modèle de score (2
  mesures, grilles 0-5, pondérations, non-disponible) **avec `docs/spec/input/VISION.md`** avant la
  refonte des Grilles (GR1) et tout ajustement de pondération. *Livrable : grilles validées + tracé VISION.*
- **S2 — Brainstorm h2a** : séance de brainstorm sur la coordination humain↔agent (rôles, POLICY,
  journal, place dans le flux) avant le rework Coordination (H2A1) et l'intégration chat↔outils.
  *Livrable : design h2a validé pour la démo.*

## 7. Séquencement proposé
1. **S1 + S2** (séances) — débloquent Grilles + Coordination/chat.
2. Reworks non gatés (en parallèle, vue par vue, UAT à chaque) : G1 jargon, RA3 suppression Radar +
   Signaux (SI1–SI4), Onboarding (ON1/ON2), Opportunités réel/sim (OP1), Console (+SRC1, CO1/CO2),
   Automatisation (+CMP1).
3. Chat global (CH1) après S2. Grilles (GR1) après S1. Coordination (H2A1) après S2.

## 8. Hors périmètre (inchangé — escalades D1–D20)
Les différés serveur restent : adapter `@sentropic/h2a` réel (crypto/journal signé), persistance SQL
journal/timeline, orchestration jobs/scheduler/connecteurs réels. Voir `UAT_EV2_EV7_ESCALATIONS.md`.
