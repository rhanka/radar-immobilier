/**
 * Routes — Marquage d'équipe Steve (Inc 2).
 *
 * API REST écriture + canal SSE temps réel.
 * SSE : réutilise le stream-bus du chat (api/src/services/chat/stream-bus.ts).
 *
 * Endpoints :
 *   POST /api/v1/prospects/marks
 *     — Crée/met à jour un marquage (append-only, supersedes calculé en transaction LWW).
 *   POST /api/v1/prospects/notes
 *     — Ajoute une note append-only.
 *   POST /api/v1/prospects/marks/batch
 *     — Marquage de masse par zone (idempotent, 1 acte = 1 frame SSE).
 *   GET  /api/v1/prospects/lots/:lotVersionId/marks
 *     — État courant des marquages actifs d'un lot (superseded_by IS NULL).
 *   GET  /api/v1/prospects/lots/:noLot/:citySlug/marks
 *     — État courant des marquages actifs d'un lot par noLot+citySlug.
 *   GET  /api/v1/prospects/zones/:citySlug/marks
 *     — État courant des marquages actifs d'une zone.
 *   GET  /api/v1/prospects/lots/:noLot/:citySlug/notes
 *     — Notes d'un lot (append-only, toutes).
 *   GET  /api/v1/prospects/contacts/:noLot/:citySlug
 *     — Stub documenté pour Inc 3 (retourne 501 avec description).
 *
 * Loi 25 : les endpoints marquage/notes ne retournent jamais le nom
 * propriétaire. La couche contact est isolée dans contact-service.ts.
 *
 * Auth : seuls les utilisateurs authentifiés (session OIDC) peuvent écrire.
 * En open-mode (auth désactivée / tests) : authorId peut être fourni dans
 * le body. En mode prod : authorId est résolu depuis la session.
 */

import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { accountUsers, prospectMarks } from "../db/schema.js";
import {
  SESSION_COOKIE_NAME,
  verifySession,
} from "../services/auth/session.js";
import {
  upsertMark,
  addNote,
  editNote,
  softDeleteNote,
  listNotes,
  batchUpsertMarks,
  getActiveMarksForLot,
  getActiveMarksForZone,
  getNotesForLot,
  type ProspectDimension,
  type ProspectStatut,
  type ProspectMode,
} from "../services/prospect/marks-service.js";
import { publish } from "../services/chat/stream-bus.js";

// ─── Constante SSE ────────────────────────────────────────────────────────────

/** Stream ID partagé pour tous les événements de marquage. */
export const PROSPECT_STREAM_ID = "prospect-marks";

// ─── Schémas de validation ────────────────────────────────────────────────────

const ModeEnum = z.enum(["real", "simulation"] as const);

const createMarkSchema = z.discriminatedUnion("dimension", [
  z.object({
    lotVersionId: z.string().uuid(),
    noLot: z.string().min(1),
    citySlug: z.string().min(1),
    dimension: z.literal("pipeline"),
    statut: z.enum(["favori", "ecarte", "sollicite", "lettre_envoyee"]),
    mode: ModeEnum.default("real"),
    authorId: z.string().uuid().optional(),
  }),
  z.object({
    lotVersionId: z.string().uuid(),
    noLot: z.string().min(1),
    citySlug: z.string().min(1),
    dimension: z.literal("marche"),
    statut: z.literal("en_vente"),
    mode: ModeEnum.default("real"),
    authorId: z.string().uuid().optional(),
    prixDemande: z.number().positive().optional(),
    lienAnnonce: z.string().url().optional(),
  }),
]);

const NOTE_BODY_MAX = 10_000;

// Création d'annotation — union discriminée sur `target_type` (contrat §6.1).
// `signal_id`-au-create est enforce ICI (règle applicative), PAS en CHECK DB
// (le CHECK d'ancre relâche la branche signal pour survivre au ON DELETE SET NULL).
const createNoteSchema = z.discriminatedUnion("target_type", [
  z.object({
    target_type: z.literal("lot"),
    no_lot: z.string().min(1),
    city_slug: z.string().min(1),
    body: z.string().min(1).max(NOTE_BODY_MAX),
    mode: ModeEnum.default("real"),
    authorId: z.string().uuid().optional(),
  }),
  z.object({
    target_type: z.literal("signal"),
    signal_id: z.string().uuid(),
    // Contexte géo optionnel (si le signal résout vers un lot — géo-mapper).
    no_lot: z.string().min(1).optional(),
    city_slug: z.string().min(1).optional(),
    body: z.string().min(1).max(NOTE_BODY_MAX),
    mode: ModeEnum.default("real"),
    authorId: z.string().uuid().optional(),
  }),
]);

// Édition in-place (contrat §6.3) — author-only.
const editNoteSchema = z.object({
  body: z.string().min(1).max(NOTE_BODY_MAX),
  authorId: z.string().uuid().optional(),
});

// Suppression soft (contrat §6.4) — author-only.
const deleteNoteSchema = z.object({
  authorId: z.string().uuid().optional(),
});

// Lecture unifiée (contrat §6.2) — query discriminée sur `target_type`.
const listNotesQuerySchema = z.discriminatedUnion("target_type", [
  z.object({
    target_type: z.literal("lot"),
    no_lot: z.string().min(1),
    city_slug: z.string().min(1),
  }),
  z.object({
    target_type: z.literal("signal"),
    signal_id: z.string().uuid(),
  }),
]);

const batchMarkSchema = z.object({
  lotVersionIds: z.array(z.string().uuid()).min(1).max(500),
  lotMeta: z.record(
    z.string().uuid(),
    z.object({ noLot: z.string().min(1), citySlug: z.string().min(1) }),
  ),
  dimension: z.enum(["pipeline", "marche"] as const),
  statut: z.enum(["favori", "ecarte", "sollicite", "lettre_envoyee", "en_vente"] as const),
  mode: ModeEnum.default("real"),
  authorId: z.string().uuid().optional(),
});

// ─── Deps ─────────────────────────────────────────────────────────────────────

export interface ProspectMarksDeps {
  db: Database;
  /** Session secret pour vérifier le cookie (absent = open mode). */
  sessionSecret?: string;
}

// ─── Helper auth ──────────────────────────────────────────────────────────────

type HonoContext = Context;

/**
 * Résout l'id d'un user APPROUVÉ depuis la session (prod). Renvoie null si pas
 * de cookie / session invalide / user non-approuvé (pending/rejected/suspended).
 * Le gate approved est re-vérifié à CHAQUE requête (ferme le trou d'une session
 * émise avant une suspension ultérieure — contrat §5).
 */
async function resolveSessionApprovedId(
  c: HonoContext,
  deps: ProspectMarksDeps,
): Promise<string | null> {
  if (!deps.sessionSecret) return null;
  const token = getCookie(c, SESSION_COOKIE_NAME);
  if (!token) return null;
  const session = await verifySession(token, {
    sessionSecret: deps.sessionSecret,
  });
  if (!session?.sub) return null;
  const rows = await deps.db
    .select({ id: accountUsers.id })
    .from(accountUsers)
    .where(and(eq(accountUsers.sub, session.sub), eq(accountUsers.status, "approved")))
    .limit(1);
  return rows[0]?.id ?? null;
}

/**
 * Auteur d'une MUTATION (create/edit/delete). Durcissement §7 : en prod (auth
 * activée, `sessionSecret` présent) l'identité de SESSION PRIME et l'override
 * `authorId` du body est REFUSÉ (anti-spoof — l'authz author-only en dépend).
 * L'override body n'est toléré QU'en open-mode (auth désactivée / tests).
 */
async function resolveAuthorId(
  c: HonoContext,
  deps: ProspectMarksDeps,
  bodyAuthorId?: string,
): Promise<string | null> {
  if (deps.sessionSecret) return resolveSessionApprovedId(c, deps);
  return bodyAuthorId ?? null;
}

/**
 * Lecteur autorisé (contrat §5, lecture = tous approuvés). Open-mode : autorisé
 * (tests). Prod : requiert une session d'un user approuvé.
 */
async function isApprovedReader(
  c: HonoContext,
  deps: ProspectMarksDeps,
): Promise<boolean> {
  if (!deps.sessionSecret) return true;
  return (await resolveSessionApprovedId(c, deps)) !== null;
}

/** Attribution visible (contrat §3.2) : id + nom/email de l'auteur. */
async function resolveAuthorSummary(
  deps: ProspectMarksDeps,
  authorId: string,
): Promise<{ id: string; name: string | null; email: string | null }> {
  const [u] = await deps.db
    .select({ id: accountUsers.id, name: accountUsers.name, email: accountUsers.email })
    .from(accountUsers)
    .where(eq(accountUsers.id, authorId))
    .limit(1);
  return u ?? { id: authorId, name: null, email: null };
}

// ─── Route ────────────────────────────────────────────────────────────────────

export function prospectMarksRoute(deps: ProspectMarksDeps): Hono {
  const app = new Hono();

  // ── POST /api/v1/prospects/marks ──────────────────────────────────────────

  app.post("/api/v1/prospects/marks", async (c) => {
    const parsed = createMarkSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return c.json({ error: "Invalid request", details: parsed.error.issues }, 400);
    }

    const body = parsed.data;
    const authorId = await resolveAuthorId(c, deps, body.authorId);
    if (!authorId) {
      return c.json({ error: "authorId requis (session ou body)" }, 400);
    }

    const mark = await upsertMark(deps.db, {
      lotVersionId: body.lotVersionId,
      noLot: body.noLot,
      citySlug: body.citySlug,
      dimension: body.dimension as ProspectDimension,
      statut: body.statut as ProspectStatut,
      mode: (body.mode ?? "real") as ProspectMode,
      authorId,
      prixDemande: "prixDemande" in body ? (body.prixDemande ?? null) : null,
      lienAnnonce: "lienAnnonce" in body ? (body.lienAnnonce ?? null) : null,
    });

    // Frame SSE — réutilise le stream-bus du chat
    await publish(PROSPECT_STREAM_ID, "prospect:mark", {
      action: "upsert",
      mark: {
        id: mark.id,
        lotVersionId: mark.lotVersionId,
        noLot: mark.noLot,
        citySlug: mark.citySlug,
        dimension: mark.dimension,
        statut: mark.statut,
        mode: mark.mode,
        authorId: mark.authorId,
        supersedes: mark.supersedes,
        createdAt: mark.createdAt,
      },
    });

    return c.json({ ok: true, mark }, 201);
  });

  // ── POST /api/v1/prospects/notes (création, ancre lot|signal, §6.1) ───────

  app.post("/api/v1/prospects/notes", async (c) => {
    const parsed = createNoteSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return c.json({ error: "Invalid request", details: parsed.error.issues }, 400);
    }

    const body = parsed.data;
    const authorId = await resolveAuthorId(c, deps, body.authorId);
    if (!authorId) {
      return c.json({ error: "authorId requis (session approuvée ou body en open-mode)" }, 401);
    }

    const note = await addNote(deps.db, {
      targetType: body.target_type,
      noLot: body.no_lot ?? null,
      citySlug: body.city_slug ?? null,
      signalId: body.target_type === "signal" ? body.signal_id : null,
      authorId,
      body: body.body,
      mode: (body.mode ?? "real") as ProspectMode,
    });

    const author = await resolveAuthorSummary(deps, authorId);

    // Frame SSE
    await publish(PROSPECT_STREAM_ID, "prospect:note", {
      action: "add",
      note: {
        id: note.id,
        targetType: note.targetType,
        noLot: note.noLot,
        citySlug: note.citySlug,
        signalId: note.signalId,
        authorId: note.authorId,
        author,
        body: note.body,
        mode: note.mode,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
      },
    });

    return c.json({ ok: true, note: { ...note, author } }, 201);
  });

  // ── GET /api/v1/prospects/notes?target_type=… (unifié lot|signal, §6.2) ───
  // Lecture = tous les users approuvés ; notes actives (deleted_at IS NULL),
  // attribuées (author id + nom/email), triées created_at desc.

  app.get("/api/v1/prospects/notes", async (c) => {
    if (!(await isApprovedReader(c, deps))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const parsed = listNotesQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: "Invalid query", details: parsed.error.issues }, 400);
    }
    const q = parsed.data;
    const notes =
      q.target_type === "lot"
        ? await listNotes(deps.db, { targetType: "lot", noLot: q.no_lot, citySlug: q.city_slug })
        : await listNotes(deps.db, { targetType: "signal", signalId: q.signal_id });
    return c.json({ ok: true, notes });
  });

  // ── PATCH /api/v1/prospects/notes/:id (édition in-place, author-only, §6.3) ─

  app.patch("/api/v1/prospects/notes/:id", async (c) => {
    const id = c.req.param("id");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return c.json({ error: "id invalide" }, 400);
    }
    const parsed = editNoteSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid request", details: parsed.error.issues }, 400);
    }
    const authorId = await resolveAuthorId(c, deps, parsed.data.authorId);
    if (!authorId) {
      return c.json({ error: "authorId requis (session approuvée ou body en open-mode)" }, 401);
    }
    const result = await editNote(deps.db, id, authorId, parsed.data.body);
    if (result.status === "not_found") return c.json({ error: "note introuvable" }, 404);
    if (result.status === "forbidden") return c.json({ error: "author-only" }, 403);

    const author = await resolveAuthorSummary(deps, result.note.authorId);
    await publish(PROSPECT_STREAM_ID, "prospect:note", {
      action: "edit",
      note: {
        id: result.note.id,
        targetType: result.note.targetType,
        noLot: result.note.noLot,
        citySlug: result.note.citySlug,
        signalId: result.note.signalId,
        authorId: result.note.authorId,
        author,
        body: result.note.body,
        mode: result.note.mode,
        createdAt: result.note.createdAt,
        updatedAt: result.note.updatedAt,
      },
    });
    return c.json({ ok: true, note: { ...result.note, author } });
  });

  // ── DELETE /api/v1/prospects/notes/:id (soft-delete, author-only, §6.4) ────

  app.delete("/api/v1/prospects/notes/:id", async (c) => {
    const id = c.req.param("id");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return c.json({ error: "id invalide" }, 400);
    }
    // Body facultatif (authorId open-mode) — un body absent/vide est valide.
    const parsed = deleteNoteSchema.safeParse(await c.req.json().catch(() => ({})));
    const bodyAuthorId = parsed.success ? parsed.data.authorId : undefined;
    const authorId = await resolveAuthorId(c, deps, bodyAuthorId);
    if (!authorId) {
      return c.json({ error: "authorId requis (session approuvée ou body en open-mode)" }, 401);
    }
    const result = await softDeleteNote(deps.db, id, authorId);
    if (result.status === "not_found") return c.json({ error: "note introuvable" }, 404);
    if (result.status === "forbidden") return c.json({ error: "author-only" }, 403);

    await publish(PROSPECT_STREAM_ID, "prospect:note", {
      action: "delete",
      note: {
        id: result.note.id,
        targetType: result.note.targetType,
        noLot: result.note.noLot,
        citySlug: result.note.citySlug,
        signalId: result.note.signalId,
        authorId: result.note.authorId,
        deletedAt: result.note.deletedAt,
      },
    });
    return c.json({ ok: true });
  });

  // ── POST /api/v1/prospects/marks/batch ────────────────────────────────────

  app.post("/api/v1/prospects/marks/batch", async (c) => {
    const parsed = batchMarkSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return c.json({ error: "Invalid request", details: parsed.error.issues }, 400);
    }

    const body = parsed.data;
    const authorId = await resolveAuthorId(c, deps, body.authorId);
    if (!authorId) {
      return c.json({ error: "authorId requis (session ou body)" }, 400);
    }

    const result = await batchUpsertMarks(deps.db, {
      lotVersionIds: body.lotVersionIds,
      lotMeta: body.lotMeta,
      dimension: body.dimension as ProspectDimension,
      statut: body.statut as ProspectStatut,
      mode: (body.mode ?? "real") as ProspectMode,
      authorId,
    });

    // 1 frame SSE pour tout le batch (1 acte = 1 frame, idempotent)
    const firstLotId = body.lotVersionIds[0] ?? "";
    await publish(PROSPECT_STREAM_ID, "prospect:batch", {
      action: "batch_upsert",
      dimension: body.dimension,
      statut: body.statut,
      citySlug: body.lotMeta[firstLotId]?.citySlug ?? null,
      created: result.created,
      lots: result.lots,
    });

    return c.json({ ok: true, ...result }, 201);
  });

  // ── GET /api/v1/prospects/lots/:lotVersionId/marks ────────────────────────

  app.get("/api/v1/prospects/lots/:lotVersionId/marks", async (c) => {
    const lotVersionId = c.req.param("lotVersionId");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(lotVersionId)) {
      return c.json({ error: "lotVersionId invalide" }, 400);
    }

    const marks = await deps.db
      .select()
      .from(prospectMarks)
      .where(
        and(
          eq(prospectMarks.lotVersionId, lotVersionId),
          isNull(prospectMarks.supersededBy),
        ),
      );

    return c.json({ ok: true, lotVersionId, marks });
  });

  // ── GET /api/v1/prospects/zones/:citySlug/marks ───────────────────────────

  app.get("/api/v1/prospects/zones/:citySlug/marks", async (c) => {
    const citySlug = c.req.param("citySlug");
    if (!citySlug || citySlug.length > 100) {
      return c.json({ error: "citySlug invalide" }, 400);
    }

    const marks = await getActiveMarksForZone(deps.db, citySlug);
    return c.json({ ok: true, citySlug, marks });
  });

  // ── GET /api/v1/prospects/lots/:noLot/:citySlug/notes ────────────────────

  app.get("/api/v1/prospects/lots/:noLot/:citySlug/notes", async (c) => {
    const noLot = c.req.param("noLot");
    const citySlug = c.req.param("citySlug");
    if (!noLot || !citySlug) {
      return c.json({ error: "noLot et citySlug requis" }, 400);
    }

    const notes = await getNotesForLot(deps.db, noLot, citySlug);
    return c.json({ ok: true, noLot, citySlug, notes });
  });

  // ── GET /api/v1/prospects/lots/:noLot/:citySlug/marks ────────────────────
  // Variante par noLot+citySlug (UI sans lotVersionId)

  app.get("/api/v1/prospects/lots/:noLot/:citySlug/marks", async (c) => {
    const noLot = c.req.param("noLot");
    const citySlug = c.req.param("citySlug");
    if (!noLot || !citySlug) {
      return c.json({ error: "noLot et citySlug requis" }, 400);
    }

    const marks = await getActiveMarksForLot(deps.db, noLot, citySlug);
    return c.json({ ok: true, noLot, citySlug, marks });
  });

  // ── GET /api/v1/prospects/contacts/:noLot/:citySlug — stub Inc 3 ──────────
  //
  // PII Loi 25 : l'accès sera journalisé dans prospect_contact_access_log.
  // Inc 3 implémentera la lecture complète avec contrôle de rôle +
  // journalisation via contact-service.ts.
  // Finalité documentée : prospection immobilière pour rachat de terrains.

  app.get("/api/v1/prospects/contacts/:noLot/:citySlug", (c) => {
    return c.json(
      {
        error: "not_implemented",
        message:
          "Accès aux données PII (contact propriétaire) non disponible dans Inc 2. " +
          "Implémentation prévue en Inc 3 avec journalisation Loi 25 complète. " +
          "Finalité : prospection immobilière pour rachat de terrains (art. 12 Loi 25 QC).",
        inc: 3,
      },
      501,
    );
  });

  return app;
}
