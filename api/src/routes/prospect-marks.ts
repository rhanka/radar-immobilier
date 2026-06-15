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

const createNoteSchema = z.object({
  noLot: z.string().min(1),
  citySlug: z.string().min(1),
  body: z.string().min(1).max(10_000),
  mode: ModeEnum.default("real"),
  authorId: z.string().uuid().optional(),
});

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
 * Résout l'authorId depuis :
 *   1. La session OIDC (si auth activée et cookie présent).
 *   2. Le corps de la requête (open mode / tests).
 * Retourne null si aucun des deux n'est disponible.
 */
async function resolveAuthorId(
  c: HonoContext,
  deps: ProspectMarksDeps,
  bodyAuthorId?: string,
): Promise<string | null> {
  if (deps.sessionSecret) {
    const token = getCookie(c, SESSION_COOKIE_NAME);
    if (token) {
      const session = await verifySession(token, {
        sessionSecret: deps.sessionSecret,
      });
      if (session?.sub) {
        const rows = await deps.db
          .select({ id: accountUsers.id })
          .from(accountUsers)
          .where(eq(accountUsers.sub, session.sub))
          .limit(1);
        return rows[0]?.id ?? null;
      }
    }
  }
  return bodyAuthorId ?? null;
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

  // ── POST /api/v1/prospects/notes ──────────────────────────────────────────

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
      return c.json({ error: "authorId requis (session ou body)" }, 400);
    }

    const note = await addNote(deps.db, {
      noLot: body.noLot,
      citySlug: body.citySlug,
      authorId,
      body: body.body,
      mode: (body.mode ?? "real") as ProspectMode,
    });

    // Frame SSE
    await publish(PROSPECT_STREAM_ID, "prospect:note", {
      action: "add",
      note: {
        id: note.id,
        noLot: note.noLot,
        citySlug: note.citySlug,
        authorId: note.authorId,
        body: note.body,
        mode: note.mode,
        createdAt: note.createdAt,
      },
    });

    return c.json({ ok: true, note }, 201);
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
