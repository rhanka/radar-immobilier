# SPEC_INTENT — SCAFFOLDING du projet `radar-immobilier`

> **Statut** : INTENT (demande initiale, avant brainstorming et conception)
> **Date** : 2026-05-23
> **Auteur de la demande** : utilisateur (fabien.antoine@gmail.com)
> **Cible aval** : `SPEC_EVOL_SCAFFOLDING.md` puis `SPEC_SCAFFOLDING.md` une fois finalisé.

## 1. Contexte produit

Le projet `radar-immobilier` met en œuvre la vision décrite dans `docs/spec/input/VISION.md` (cahier de vision complet) et `docs/spec/input/PROCESS.md` (processus opérationnel) : un **radar immobilier IA** capable de surveiller automatiquement les documents municipaux d'une ville et d'identifier des opportunités de densification résidentielle (zonage, PPCMOI, dérogations, CPTAQ, etc.).

- **Ville pilote** : Salaberry-de-Valleyfield.
- **Phase 1 (priorité immédiate)** : *démo* destinée à présenter une **proposition commerciale et un chiffrage** au client. La règle d'or est : *plus on a déjà mis en œuvre de la vision au moment du chiffrage, mieux c'est* — la démo doit donc tirer le plus loin possible vers la vision tout en restant livrable rapidement.
- **Phase 2** (post-démo) : carte interactive et industrialisation.

Acteurs principaux (à approfondir au brainstorming) :
- **Client / commanditaire** (développeur ou investisseur immobilier au Québec) — destinataire du chiffrage.
- **Analyste développement immobilier** (utilisateur final cible) — consomme les fiches d'opportunités produites par le radar.
- **Veilleur municipal automatisé** (l'IA) — scrape, lit, transcrit, relie, score.
- **Sources municipales** (sites villes, PDF, vidéos YouTube de conseils, portails cartographiques, Données Québec, CPTAQ, etc.).

## 2. Objectif du scaffolding

Mettre en place dès maintenant la structure du projet `radar-immobilier` (code, infra, specs, plan d'exécution) en **réutilisant au maximum** l'écosystème déjà construit par l'utilisateur, afin de pouvoir attaquer la Phase 1 sur des rails éprouvés.

## 3. Choix techniques imposés par la demande

### 3.1 Stack applicative
- **SPA Svelte** (frontend) — déploiement sur **GitHub Pages**.
- **Server TypeScript / Node** (backend) — hébergé sur le **cluster K8s POC** (`../poc-k8s` → Scaleway Kapsule, cluster `poc`).

### 3.2 Réutilisation maximale `@sentropic/*`
À consommer comme dépendances npm (ou monorepo workspace si pertinent) :
- `@sentropic/contracts` — contrats wire / types partagés.
- `@sentropic/events` — événements applicatifs.
- `@sentropic/chat-core` — orchestration chat (CheckpointStore, MessageStore, SessionStore, ToolRegistry, AgentRuntime).
- `@sentropic/chat-ui` (Svelte) — composants UI chat (`ChatPanel`, `ChatWidget`, `StreamMessage`, `ChatTimeline`, `ChatComposer`, etc.).
- `@sentropic/llm-mesh` — accès LLM provider-agnostic.
- `@sentropic/flow` — runtime de flows (extraction en cours côté sentropic).
- **Design system sentropic** (à identifier précisément dans `ui/` de sentropic — Tailwind config, composants partagés).

### 3.3 Réutilisation `graphify`
- `graphifyy` (npm, pas encore migré sur `@sentropic/*`) — graphe de connaissances pour relier documents municipaux, règlements, dossiers, lots. Utile pour la couche "intelligence" du radar (relier les documents entre eux, reconstruire le contexte d'un règlement).

### 3.4 Réutilisation des mécanismes dev sentropic (`../sentropic/`)
- **`rules/`** (MASTER.md, workflow.md, conductor.md, subagents.md, testing.md, etc.) — règles consolidées chargées par `CLAUDE.md` / `AGENTS.md`.
- **`.claude/skills/`** (branch-init, branch-close, debug-*, lot-gate, new-route, scope-check, etc.) — skills custom du projet.
- **`Makefile`** — make-only, docker-first, compose isolation par `ENV=<slug>`.
- **Structure de plan** : `PLAN.md` racine (roadmap orchestrée) + `plan/NN-BRANCH_<slug>.md` (un fichier par branche, scope/lots/checkboxes).
- **Worktrees** : développement en `tmp/<slug>` isolé, jamais sur la racine.

### 3.5 Outils complémentaires
- **`obscura`** — utilisé pour le **scraping "grey"** (sources municipales aux formats hétérogènes, contournement de protections légères, gestion des PDF non standardisés, etc.). À intégrer côté server.
- **`imeccable`** (npm) — complément design en attendant la consolidation du design system.
- **`superpowers`** (plugin Claude Code, déjà actif) — skills meta (brainstorming, writing-plans, executing-plans, TDD, verification, etc.).

### 3.6 Déploiement
- **Frontend SPA Svelte** → GitHub Pages (`gh.pages`).
- **Server TS Node** → K8s POC via `../poc-k8s/tenants/radar-immobilier/` (à créer en suivant le contrat `contracts/README.md` : Namespace + ResourceQuota + LimitRange + NetworkPolicy + ServiceAccount).
- Cible Scaleway `fr-par-2`, pool `default` partagé (ressources limitées : 4 GB / 3 vCPU à la base, burst possible).

## 4. Organisation des specs

Convention demandée pour `docs/spec/` :

| Phase | Pattern de nom | Rôle |
|-------|----------------|------|
| Demande initiale (client/utilisateur) | `SPEC_INTENT_{topic}.md` | Fige la demande de départ, sans engagement de conception. |
| Pendant le dev | `SPEC_EVOL_{topic}.md` | Document vivant, évolue avec les décisions de conception et lots. |
| Finalisé | `SPEC_{topic}.md` | Version consolidée et stable une fois la fonctionnalité livrée. |

`docs/spec/input/` reste réservé aux **inputs externes bruts** fournis par le client (VISION, PROMPT, PROCESS).

## 5. Suite immédiate (hors scope de ce SPEC_INTENT)

1. **Brainstorming** (en cours) pour clarifier : périmètre exact de la démo Phase 1, choix de réutilisation vs duplication, intégration `obscura` / `graphify` / `@sentropic/*`, structure du monorepo, configuration K8s tenant, premier découpage en branches.
2. **`SPEC_EVOL_SCAFFOLDING.md`** : document de conception détaillée issu du brainstorming.
3. **`PLAN.md` + `plan/NN-BRANCH_*.md`** : roadmap orchestrée et fichiers de branche.
4. **`BR-00 scaffolding`** : première branche pour poser la structure (workspace, Makefile, docker-compose, rules, skills, CI/CD, tenant K8s).

## 6. Contraintes transverses

- **Langue** : code, commits, PR, specs en **anglais** ; échanges utilisateur en **français**.
- **Make-only / Docker-first** : aucune commande native sur l'hôte (cf. `rules/MASTER.md` de sentropic).
- **Atomic commits** (~150 lignes max), `git add` sélectif, `make commit MSG="..."`.
- **Pas de squash merge** : politique stricte héritée de sentropic (perte d'historique). Merge commit uniquement.
- **No legacy fallback** : on supprime le code remplacé, pas de double chemin.

## 7. Critères de succès du scaffolding

- Un développeur (ou un sub-agent) qui clone le repo peut, en suivant le `README` + `make help`, lancer le dev local (`make dev`), exécuter les tests (`make test`, `make test-e2e`), et déployer une preview sur K8s POC.
- Les libs `@sentropic/*` sont déjà câblées (au moins `contracts`, `events`, `llm-mesh`, `chat-core`, `chat-ui`).
- Le squelette de `PLAN.md` et au moins une branche `plan/00-BRANCH_*.md` existent.
- Une démo end-to-end *minimale mais représentative* tourne (ex : un chat qui interroge le radar sur Salaberry-de-Valleyfield et restitue une fiche d'opportunité, même synthétique au départ).
