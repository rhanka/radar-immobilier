/**
 * ÉV15 — Backlog API (demo, in-memory store).
 *
 *   GET  /api/backlog                  — seed evolutions + added items
 *   POST /api/backlog/items            — add a request (statut "a-faire")
 *   POST /api/backlog/items/:id/process — process a request (-> "en-cours")
 *
 * The store is a process-lifetime in-memory map (the demo has no persistence
 * layer for the backlog). The Backlog view merges this with the static UI seed
 * (`ui/src/lib/backlog/backlog-data.ts`), de-duplicated by id, so the two seeds
 * collapse into one faithful list.
 *
 * No fictional data: the seed below mirrors the real evolution track (the same
 * codes/PR numbers the UI seed carries), and added items come only from real
 * user/chat requests.
 */

import { Hono } from "hono";
import { z } from "zod";

/** Lifecycle status of a backlog item (board column). */
export type BacklogStatut = "a-faire" | "en-cours" | "realise";

/** A single backlog item. */
export interface BacklogItem {
  id: string;
  code: string;
  titre: string;
  description: string;
  statut: BacklogStatut;
  pr?: number;
}

/**
 * Server-side seed. Faithful to the merged Git history (PR numbers verified via
 * `gh pr list --state merged`). Kept in sync with the UI seed; ids collide on
 * purpose so the view's merge de-duplicates cleanly.
 */
const SEED: readonly BacklogItem[] = [
  { id: "ev1-socle-states-scoring", code: "ÉV1", titre: "Socle : modèle d'états + grilles de score", description: "Modèle d'états + @radar/scoring + calibration sur les 3 pilotes Valleyfield + vue Grilles.", statut: "realise", pr: 18 },
  { id: "ev2-radar-t1-signals", code: "ÉV2", titre: "Radar T1 : flux de signaux", description: "Flux de signaux (valeur/confiance triables, filtre statut + réel/sim, action Approfondir).", statut: "realise", pr: 19 },
  { id: "ev3-opportunites-t2-funnel", code: "ÉV3", titre: "Opportunités T2 : entonnoir 6 phases", description: "Entonnoir 6 phases + score honnête + bascule réel/simulation + signal→N opportunités.", statut: "realise", pr: 20 },
  { id: "ev4-onboarding-sources", code: "ÉV4", titre: "Onboarding T0 : catalogue de sources", description: "Checklist du catalogue + rétro-analyse 2 ans + CTA Lancer l'onboarding.", statut: "realise", pr: 21 },
  { id: "ev5-coordination-chat-stub", code: "ÉV5", titre: "Coordination humain↔agents (concepts h2a)", description: "Interface de coordination découplée (rôle/POLICY/journal) + chat stub. Adaptateur h2a réel différé.", statut: "realise", pr: 22 },
  { id: "ev6-consoles-t3-t4", code: "ÉV6", titre: "Console T3/T4 : qualification + jobs", description: "Qualification des sources + approfondissement + tableau de suivi des jobs.", statut: "realise", pr: 23 },
  { id: "ev7-automation-benchmark", code: "ÉV7", titre: "Automatisation + benchmark par étape", description: "Cadences de traitement + connecteurs + récapitulatif de benchmark agent honnête.", statut: "realise", pr: 24 },
  { id: "ev8-recadrage-demo", code: "ÉV8", titre: "Recadrage démo : app-shell + 100% design-system", description: "App-shell dense + registre des bugs UAT résolus + passage 100% design-system.", statut: "realise", pr: 26 },
  { id: "ev9-chat-reel", code: "ÉV9", titre: "Chat réel multi-fournisseurs", description: "Chat-ui réel (chat-ui + chat-core + llm-mesh) multi-fournisseurs, tokens streamés via SSE.", statut: "realise", pr: 34 },
  { id: "chat-shortlist-fix", code: "Fix chat", titre: "Correctif chat : shortlist de modèles réelle", description: "Câble la shortlist réelle de sentropic + sélecteur de modèle groupé par fournisseur.", statut: "realise", pr: 35 },
  { id: "ev11-automation-reelle", code: "ÉV11", titre: "Collecte RÉELLE d'une source publique", description: "Collecte réelle sans clé d'une source publique de Valleyfield. Aucune donnée fabriquée.", statut: "realise", pr: 32 },
  { id: "ev12-uat-round4", code: "ÉV12", titre: "UI round 4 : nav horizontale + accordéons + master-detail", description: "Nav horizontale + accordéon Signaux + libellé de filtre lisible, puis master-detail + accordéon Sources + refonte Grilles.", statut: "realise", pr: 31 },
  { id: "ev14-uat-round5", code: "ÉV14", titre: "UAT round 5 : bande latérale uniforme + Automatisation→Sources", description: "Bande latérale standardisée (w-72) sur 5 vues + Automatisation comme onglet de Sources + sélection Opportunités renforcée.", statut: "realise", pr: 37 },
  { id: "ev15-backlog", code: "ÉV15", titre: "Vue Backlog pilotée par le chat", description: "Vue Backlog (À faire / En cours / Réalisé) seedée des évolutions réelles + API add/process + affordance Ajouter une demande.", statut: "en-cours" },
  { id: "ev10-h2a-real-adapter", code: "ÉV10", titre: "Adaptateur h2a réel (coordination signée)", description: "Adaptateur @sentropic/h2a réel (signature crypto + journal persisté SQL). Différé côté build serveur.", statut: "a-faire" },
  { id: "chat-backlog-tools", code: "ÉV15+", titre: "Outils chat ajouter_demande / traiter_demande", description: "Tool-calling dans le pipeline chat pour piloter le backlog. Bloqué en une passe (suivi documenté).", statut: "a-faire" },
  { id: "uat-round5-accordeons-reaudit", code: "UAT5", titre: "Réaudit des accordéons (retour UAT round 5)", description: "Réappliquer le motif accordéon là où il manque, une fois lot 2 + uniformisation en place.", statut: "a-faire" },
];

const addItemSchema = z.object({
  titre: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
});

/** Build a kebab-case-ish, store-unique id from a title. */
const slugify = (titre: string): string =>
  titre
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "demande";

/**
 * In-memory store of items ADDED at runtime (seed items are not stored, they
 * are streamed from `SEED` on every GET so a restart resets to the truth).
 * Exported as a factory so tests get an isolated store per app instance.
 */
export interface BacklogStore {
  list(): BacklogItem[];
  add(item: BacklogItem): void;
  get(id: string): BacklogItem | undefined;
  setStatut(id: string, statut: BacklogStatut): BacklogItem | undefined;
}

export function createBacklogStore(): BacklogStore {
  const added = new Map<string, BacklogItem>();
  return {
    list: () => [...added.values()],
    add: (item) => {
      added.set(item.id, item);
    },
    get: (id) => added.get(id),
    setStatut: (id, statut) => {
      const existing = added.get(id);
      if (!existing) return undefined;
      const updated = { ...existing, statut };
      added.set(id, updated);
      return updated;
    },
  };
}

/** Process-lifetime default store for the running demo API. */
const defaultStore = createBacklogStore();

/**
 * Builds the /api/backlog routes. A `store` can be injected for tests;
 * production uses the shared process-lifetime store.
 */
export function backlogRoute(store: BacklogStore = defaultStore): Hono {
  const app = new Hono();

  /** Seed evolutions + items added at runtime (added override seed by id). */
  app.get("/api/backlog", (c) => {
    const byId = new Map<string, BacklogItem>();
    for (const item of SEED) byId.set(item.id, item);
    for (const item of store.list()) byId.set(item.id, item);
    return c.json({ items: [...byId.values()] });
  });

  /** Add a request -> statut "a-faire". */
  app.post("/api/backlog/items", async (c) => {
    const parsed = addItemSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid request", details: parsed.error.issues }, 400);
    }
    const { titre, description } = parsed.data;
    const base = slugify(titre);
    let id = base;
    let n = 2;
    while (store.get(id) || SEED.some((s) => s.id === id)) {
      id = `${base}-${n}`;
      n += 1;
    }
    const item: BacklogItem = {
      id,
      code: "Demande",
      titre,
      description: description ?? "",
      statut: "a-faire",
    };
    store.add(item);
    return c.json({ item }, 201);
  });

  /** Process a request -> statut "en-cours". Only runtime-added items move. */
  app.post("/api/backlog/items/:id/process", (c) => {
    const id = c.req.param("id");
    const updated = store.setStatut(id, "en-cours");
    if (!updated) {
      return c.json(
        {
          error: "not-found",
          detail: `No runtime backlog item with id "${id}" (seed items are read-only)`,
        },
        404,
      );
    }
    return c.json({ item: updated });
  });

  return app;
}
