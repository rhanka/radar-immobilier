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

## 9. Décisions S1 — alignement scoring ↔ VISION (figées 2026-05-27)
Séance tenue avec `VISION.md` §6 + `PROCESS.md` Étape 5. **Le modèle à 2 mesures est confirmé fidèle**
(signal /10 = VISION §6 ; opportunité 0-5 = PROCESS Étape 5). Décisions validées par le client :
- **S1.1** On garde **2 mesures distinctes**, clairement séparées dans l'UI, chacune tracée à sa source
  (Signaux = valeur /10 + confiance, VISION §6 ; Opportunités = score composite, PROCESS Étape 5).
- **S1.2 Dérogations = filtre pur** (VISION) : une dérogation pertinente (densité/hauteur/marges/
  logements/usages) **entre en analyse** ; non pertinente (cabanon/clôture) **écartée**. **Pas de
  pseudo-score /10 inventé** → retirer `derogation-relevant=5`/`irrelevant=1` du barème de tri.
- **S1.3 Types de signaux** : garder les catégories VISION §6 (zonage 10 · CPTAQ 8 · PPCMOI 7) +
  celles couvertes par §4.1 (**consultation publique, plan d'urbanisme, modification de grille/COS**).
  **Retirer** intention-politique / requalification-TOD / investissement-public (trop interprétatifs V1).
- **S1.4 Tri des signaux = LES DEUX** : bascule **« par score /10 »** et **« par priorité VISION »**
  (ordre Priorité 1→4), car la VISION est contradictoire (CPTAQ « Priorité 4 » mais 8/10 > PPCMOI 7).
  **Bulle jaune** d'aide (parcours guidé) expliquant la nuance. Défaut = tri par score.
- **S1.5 Échelle UI** : Signaux → **valeur /10 + confiance** ; Opportunités → **score radar /100**
  (= 0-5 × 20) en tête **+ détail 0-5 par axe**. Pas de changement de modèle (mêmes nombres rescalés) ;
  pilotes : **64 / 67 / 52 /100** (partiels, plafonnés « surveillance »).
- **S1.6 Poids 30/20/20/15/15 conservés** (PROCESS) pour la V1. La VISION (« avant le marché »,
  long terme structurel) justifie : Marché 15% souvent non-disponible = normal ; Timing valorise la
  **faible visibilité concurrentielle** (règle « perle rare »). À rediscuter si surpondération voulue.
- **Débloque** : la refonte des Grilles (GR1) s'adosse à cette grille validée + tracé VISION/PROCESS.

## 10. Décisions S2 — chat + h2a réels (figées 2026-05-28)
Après lecture de `../sentropic`. **Constat clé : sentropic n'utilise PAS `@sentropic/h2a` à l'exécution**
(0 import) — donc « utiliser h2a » est un **ajout net-new**, pas une recopie. Le pattern chat, lui,
est directement réutilisable.
- **Pattern layout (sentropic)** : `ChatWidget` monté dans le **layout racine**, présent sur toutes les
  vues ; mode `docked | floating` via le store `@sentropic/chat-ui/stores/chatWidgetLayout` (+ `isOpen`,
  `dockWidthCss`, préférence en `localStorage`). En docked le layout réserve un `padding-right`. →
  radar copie ça dans `App.svelte`. **Dissout l'onglet Coordination.**
- **Stack chat (réel, rien de simulé)** : UI `@sentropic/chat-ui` (Svelte 5, browser-safe) ;
  serveur Hono `@sentropic/chat-core` (ChatRuntime) + `@sentropic/llm-mesh`. Stream SSE inline via
  Hono `c.stream()` (pas besoin de la file PG NOTIFY). `@sentropic/skills` **écarté** (isolated-vm
  Node-only) → on déclare les outils radar directement.
- **LLM (S2.a)** : **tous les providers dont une clé existe** (OpenAI/Gemini/Anthropic/Mistral/Cohere)
  + **sélecteur provider/modèle in-chat**, **aucun défaut imposé** (neutre — cf. mémoire no-claude-favoritism).
- **Outils radar (S2.b)** : `query_signals`, `open_opportunity`, `explain_score`, `approfondir`
  (signal→opportunités), `navigate`, `toggle_real_sim`, `read_journal`.
- **h2a (S2.c)** : **vrai** — `@sentropic/h2a` 0.12.0 importé côté **API Node** : chaque décision
  (qualifier/surveiller/approcher) prise via le chat ou l'UI est journalisée en **enveloppe signée**
  (rôle PRINCIPAL/CONDUCTOR + POLICY + horodatage). Crypto Node OK côté serveur.

## 11. Découpage en évolutions (toutes parallélisables)
- **ÉV8 — Recadrage vues/UX** : consolidation §3 + registre §4 (hors chat/h2a) + Grilles (débloqué S1).
  Supprime ancien Radar, fusionne Signaux, Onboarding (ville), réel/sim Opportunités, Console (+sources),
  Automatisation (+comparaison), retrait jargon, score /100, dual-tri Signaux + bulle.
- **ÉV9 — Chat réel** : `@sentropic/chat-ui` + `chat-core` + `llm-mesh`, `ChatWidget` dans le layout
  (docked/floating), endpoints Hono + SSE, tous providers + sélecteur, outils radar.
- **ÉV10 — h2a réel** : `@sentropic/h2a` côté API, journal signé + rôles + POLICY autour des décisions.
- **Coordination** entre branches : ÉV8 et ÉV9 touchent tous deux `App.svelte` (nav vues + dock chat)
  → coordonner le layout. ÉV10 est surtout serveur + se branche sur les points de décision d'ÉV9.
- Ces ÉV8–ÉV10 **annulent/dépassent** l'ancien stub ÉV5 (Coordination/chat) et la D13 « découplé sans
  dep » — désormais on vise le réel (chat-ui + h2a).

## 12. Décisions S3 — UAT #2 (app-shell, redondances, live) — figées 2026-05-28
- **S3.1 Design flat → app-shell dense.** `@sentropic/design-system-skills` = **linter CLI** (jsdom),
  PAS un levier UI (utile en CI plus tard). Vrai levier = **`@sentropic/design-system-svelte`** (déjà dep) :
  `SideNav`, `Table`, `Drawer`, `Tabs`, `Card`, `Popover`, `Modal`. Radar n'en utilise rien → mono-colonne
  plat. **ÉV8 reciblé** : app-shell dense (SideNav gauche persistante + contenu `grid-cols-12` + `Table`
  pour les feeds + `Drawer` détails), puis re-polir les vues dedans.
- **S3.2 Redondances → consolidation.** (a) cadran `SourceQuadrant` (Revue-sources) ↔ Console
  `QualificationTab` = mêmes `sourceEvaluations` → **une surface Sources** (cadran = viz dans Console ;
  retirer l'entrée Revue-sources). (b) `BenchmarkComparison` (Comparaison) ↔ `benchmarkRecap`
  (Automatisation) = mêmes données → **un seul endroit** (dans Automatisation ; retirer Comparaison).
  Nav 9 → ~6.
- **S3.3 Live = agent PROMPT.md, pas ETL.** `@sentropic/remote` **n'existe pas** (404). `@sentropic/flow`
  0.1.1 = runtime d'orchestration en **ports + fonctions pures** (`runJob`/`runProcessingLoop`/`FlowRuntime`),
  **sans adapter de stockage** (table queue = ~150 LOC Drizzle applicatif). **ÉV11 redéfini** : un **agent
  LLM exécute les 6 phases de `PROMPT.md`** pour une municipalité, outils = **web_search/extract Tavily**
  (comme sentropic ; `../sentech-forge` n'a pas de provider) + helpers REST radar (rôle/cadastre/BDZI/GRHQ)
  + obscura. Lancé comme **job de fond** (boucle `flow` + table Drizzle) → UI « Lancer l'analyse → job en
  cours → progression SSE → dossiers ». Rend réel le CTA onboarding (lève D11/D17/D19). Dépend de la couche
  LLM d'ÉV9 (provider neutre). Orchestration d'agents-CLI = couche **h2a** ultérieure.
- **Séquence** : ÉV8 (app-shell + consolidation + re-polish) → ÉV9 (chat + llm-mesh + outils) → ÉV11
  (agent PROMPT.md live) ; ÉV10 (h2a) en parallèle. Prérequis ÉV11 : `TAVILY_API_KEY` + clé LLM (présents
  côté sentropic).
