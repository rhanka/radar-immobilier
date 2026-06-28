/**
 * Backlog API — wired to the REAL track sidecar (WP6).
 *
 *   GET  /api/backlog                   — real tracked items (folded from
 *                                         `.track/events.jsonl`) + runtime-added
 *                                         items; ÉV seed only as a labeled
 *                                         fallback when the sidecar is absent.
 *   GET  /api/backlog/track             — raw track buckets (DONE/TO-DO/DROPPED)
 *   POST /api/backlog/items             — add a request (statut "a-faire")
 *   POST /api/backlog/items/:id/process — process a request (-> "en-cours")
 *
 * History: the Backlog view used to read a hand-maintained in-memory ÉV seed.
 * It now reflects the genuine, event-sourced `track` backlog: per aggregate the
 * latest `realization.transition` decides the bucket (done → réalisé,
 * cancelled/rejected → abandonné, else à-faire/en-cours) and the latest
 * `acceptance.run.result` annotates it. The ÉV seed survives only as an
 * offline/CI fallback when the sidecar is not bind-mounted.
 *
 * Anti-invention: tracked items come verbatim from the sidecar; nothing is
 * fabricated. The ÉV fallback is clearly labeled (`source: "ev-fallback"`).
 *
 * The `POST` endpoints keep driving the runtime store (and the chat
 * `ajouter_demande` / `traiter_demande` tools); runtime-added items are merged
 * on top of the tracked list so a freshly-added demand shows immediately.
 */

import { Hono } from "hono";
import { z } from "zod";

import {
  loadTrackItems,
  type TrackAcceptance,
  type TrackBucket,
  type TrackItem,
} from "../services/track/track-reader.js";
import {
  loadWpProjection,
  type WpProjection,
} from "../services/track/wp-projection.js";

/** Lifecycle status of a backlog item (board column). */
export type BacklogStatut = "a-faire" | "en-cours" | "realise" | "abandonne";

/** Where a backlog item came from. */
export type BacklogSource = "track" | "request" | "ev-fallback";

/** A single backlog item. */
export interface BacklogItem {
  id: string;
  code: string;
  titre: string;
  description: string;
  statut: BacklogStatut;
  /** Provenance: live track sidecar, a runtime request, or the ÉV fallback. */
  source?: BacklogSource;
  /** Track workspace, when sourced from the sidecar (e.g. "wp4-sources"). */
  groupe?: string;
  /** Latest acceptance run, when sourced from the sidecar. */
  acceptance?: TrackAcceptance;
  /** Coarse track bucket, when sourced from the sidecar. */
  bucket?: TrackBucket;
  pr?: number;
}

/**
 * ÉV fallback seed — used ONLY when the track sidecar is unavailable (e.g. a
 * deployed env that doesn't bind-mount the repo, or offline CI). Faithful to the
 * merged Git history (PR numbers verified via `gh pr list --state merged`).
 */
const EV_FALLBACK: readonly BacklogItem[] = [
  { id: "ev1-socle-states-scoring", code: "ÉV1", titre: "Socle : modèle d'états + grilles de score", description: "Modèle d'états + @radar/scoring + calibration sur les 3 pilotes Valleyfield + vue Grilles.", statut: "realise", source: "ev-fallback", pr: 18 },
  { id: "ev2-radar-t1-signals", code: "ÉV2", titre: "Radar T1 : flux de signaux", description: "Flux de signaux (valeur/confiance triables, filtre statut + réel/sim, action Approfondir).", statut: "realise", source: "ev-fallback", pr: 19 },
  { id: "ev3-opportunites-t2-funnel", code: "ÉV3", titre: "Opportunités T2 : entonnoir 6 phases", description: "Entonnoir 6 phases + score honnête + bascule réel/simulation + signal→N opportunités.", statut: "realise", source: "ev-fallback", pr: 20 },
  { id: "ev9-chat-reel", code: "ÉV9", titre: "Chat réel multi-fournisseurs", description: "Chat-ui réel (chat-ui + chat-core + llm-mesh) multi-fournisseurs, tokens streamés via SSE.", statut: "realise", source: "ev-fallback", pr: 34 },
  { id: "ev15-backlog", code: "ÉV15", titre: "Vue Backlog pilotée par le chat", description: "Vue Backlog (À faire / En cours / Réalisé) seedée des évolutions réelles + API add/process + affordance Ajouter une demande.", statut: "en-cours", source: "ev-fallback" },
  { id: "ev10-h2a-real-adapter", code: "ÉV10", titre: "Adaptateur h2a réel (coordination signée)", description: "Adaptateur @sentropic/h2a réel (signature crypto + journal persisté SQL). Différé côté build serveur.", statut: "a-faire", source: "ev-fallback" },
];

/** Map a track realization/bucket to the backlog board column. */
function statutForTrack(item: TrackItem): BacklogStatut {
  switch (item.realization) {
    case "done":
      return "realise";
    case "in-progress":
      return "en-cours";
    case "cancelled":
    case "rejected":
      return "abandonne";
    default:
      return "a-faire";
  }
}

/** Short code from the workspace, e.g. "wp4-sources" -> "WP4-SOURCES". */
function codeForWorkspace(workspace: string): string {
  return workspace.toUpperCase();
}

/** Project a folded track item into the backlog shape (no fabrication). */
export function trackItemToBacklog(item: TrackItem): BacklogItem {
  const acceptanceNote =
    item.acceptance === "pass"
      ? "Acceptation : ✓ pass"
      : item.acceptance === "fail"
        ? "Acceptation : ✗ fail"
        : "Acceptation : —";
  return {
    id: item.id,
    code: codeForWorkspace(item.workspace),
    titre: item.title,
    description: `${item.workspace} · ${item.kind} · ${acceptanceNote}`,
    statut: statutForTrack(item),
    source: "track",
    groupe: item.workspace,
    acceptance: item.acceptance,
    bucket: item.bucket,
  };
}

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
 * In-memory store of items ADDED at runtime (the "Ajouter une demande"
 * affordance + the chat tools). Tracked items are never written here; they are
 * folded from the sidecar on every GET so the list always reflects the truth.
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
 * Reader of the track sidecar. Injectable for tests; production uses the real
 * filesystem loader (which honours `TRACK_EVENTS_PATH` and degrades gracefully).
 */
export type TrackBacklogReader = () => {
  available: boolean;
  items: BacklogItem[];
};

/** Reader of the WP projection (read-model). Injectable for tests. */
export type WpProjectionReader = () => WpProjection;

const defaultTrackReader: TrackBacklogReader = () => {
  const result = loadTrackItems();
  return {
    available: result.available,
    items: result.items.map(trackItemToBacklog),
  };
};

/**
 * Builds the /api/backlog routes. `store` and `trackReader` can be injected for
 * tests; production uses the shared store + the real filesystem track reader.
 */
export function backlogRoute(
  store: BacklogStore = defaultStore,
  trackReader: TrackBacklogReader = defaultTrackReader,
  wpProjectionReader: WpProjectionReader = () => loadWpProjection(),
): Hono {
  const app = new Hono();

  /**
   * WP projection read-model for the 4-level kanban (swimlanes WP1-6 × status
   * columns × scales now/week/month/project). Prefers the precomputed
   * `wp6-rollup.json`; falls back to a live fold of the sidecar + WP map. The WP
   * grouping is a projection (Track's workspace-contained parenting blocks a
   * physical 6-WP reparent — see docs/spec/reports/wp6-socle-status.md).
   */
  app.get("/api/backlog/wp-projection", (c) => {
    return c.json(wpProjectionReader());
  });

  /**
   * Real tracked items (folded from the sidecar) + runtime-added items.
   * When the sidecar is unavailable, falls back to the labeled ÉV seed so the
   * view is never empty. Runtime items override tracked/seed items by id.
   */
  app.get("/api/backlog", (c) => {
    const track = trackReader();
    const base = track.available ? track.items : EV_FALLBACK;
    const byId = new Map<string, BacklogItem>();
    for (const item of base) byId.set(item.id, item);
    for (const item of store.list()) byId.set(item.id, item);
    return c.json({
      items: [...byId.values()],
      source: track.available ? "track" : "ev-fallback",
    });
  });

  /** Raw track buckets (DONE / TO-DO / DROPPED). Empty when unavailable. */
  app.get("/api/backlog/track", (c) => {
    const track = trackReader();
    const buckets: Record<TrackBucket, BacklogItem[]> = {
      DONE: [],
      "TO-DO": [],
      DROPPED: [],
    };
    for (const item of track.items) {
      if (item.bucket) buckets[item.bucket].push(item);
    }
    return c.json({ available: track.available, buckets });
  });

  /** Add a request -> statut "a-faire" (runtime store). */
  app.post("/api/backlog/items", async (c) => {
    const parsed = addItemSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid request", details: parsed.error.issues }, 400);
    }
    const { titre, description } = parsed.data;
    const base = slugify(titre);
    let id = base;
    let n = 2;
    while (store.get(id)) {
      id = `${base}-${n}`;
      n += 1;
    }
    const item: BacklogItem = {
      id,
      code: "Demande",
      titre,
      description: description ?? "",
      statut: "a-faire",
      source: "request",
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
          detail: `No runtime backlog item with id "${id}" (tracked items are read-only)`,
        },
        404,
      );
    }
    return c.json({ item: updated });
  });

  return app;
}
