/**
 * Tests d'intégration — prospect_marks + prospect_notes (Inc 2).
 *
 * Nécessite une vraie DB de test (env vars POSTGRES_*).
 * Couvre :
 *   - append-only et unicité de chaîne active sous concurrence (transaction LWW)
 *   - idempotence batch
 *   - journalisation accès contact (PII Loi 25)
 */

import { afterAll, describe, expect, it, beforeEach } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { loadConfig } from "../../src/config.js";
import { createDb } from "../../src/db/client.js";
import {
  lotVersions,
  accountUsers,
  prospectMarks,
  prospectNotes,
  prospectContacts,
  prospectContactAccessLog,
  sources,
  ingestions,
  documents,
  signals,
} from "../../src/db/schema.js";
import {
  upsertMark,
  addNote,
  editNote,
  softDeleteNote,
  listNotes,
  batchUpsertMarks,
} from "../../src/services/prospect/marks-service.js";
import { getActiveContactWithLog } from "../../src/services/prospect/contact-service.js";

const { db, pool } = createDb(loadConfig());

afterAll(async () => {
  await pool.end();
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

let authorId: string;
let lotVersionId: string;
let noLot: string;
const citySlug = "integration-test-city";

beforeEach(async () => {
  // Nettoyer les données de test.
  // Les notes ancrées signal (city_slug NULL) échappent au purge par citySlug :
  // on purge d'abord les notes de l'auteur de test (FK author_id ON DELETE restrict).
  const prevAuthors = await db
    .select({ id: accountUsers.id })
    .from(accountUsers)
    .where(eq(accountUsers.email, "test-inc2@example.com"));
  for (const a of prevAuthors) {
    await db.delete(prospectNotes).where(eq(prospectNotes.authorId, a.id));
  }
  await db.delete(prospectContactAccessLog);
  await db.delete(prospectContacts);
  await db.delete(prospectNotes).where(eq(prospectNotes.citySlug, citySlug));
  await db.delete(prospectMarks).where(eq(prospectMarks.citySlug, citySlug));
  await db.delete(lotVersions).where(eq(lotVersions.citySlug, citySlug));
  await db.delete(accountUsers).where(eq(accountUsers.email, "test-inc2@example.com"));

  // Créer un auteur
  const [author] = await db
    .insert(accountUsers)
    .values({
      sub: `test-inc2-sub-${Date.now()}`,
      email: "test-inc2@example.com",
      name: "Test Inc2",
      status: "approved",
      isAdmin: false,
    })
    .returning({ id: accountUsers.id });
  authorId = author!.id;

  // Créer un lot version
  noLot = `TEST-LOT-${Date.now()}`;
  const [lot] = await db
    .insert(lotVersions)
    .values({
      canonicalId: `test-canonical-${Date.now()}`,
      noLot,
      citySlug,
      reconStatus: "validated",
      validFrom: "2024-01-01",
      knownFrom: new Date(),
      rawRef: "test-ref",
    })
    .returning({ id: lotVersions.id });
  lotVersionId = lot!.id;
});

// ─── Tests marquage unitaire ──────────────────────────────────────────────────

describe("upsertMark — append-only et unicité de chaîne", () => {
  it("crée un marquage initial (no supersedes)", async () => {
    const mark = await upsertMark(db, {
      lotVersionId,
      noLot,
      citySlug,
      dimension: "pipeline",
      statut: "favori",
      mode: "real",
      authorId,
    });

    expect(mark.id).toBeTruthy();
    expect(mark.statut).toBe("favori");
    expect(mark.supersedes).toBeNull();
    expect(mark.supersededBy).toBeNull();

    // Un seul actif en DB
    const actifs = await db
      .select()
      .from(prospectMarks)
      .where(
        and(
          eq(prospectMarks.lotVersionId, lotVersionId),
          eq(prospectMarks.dimension, "pipeline"),
          isNull(prospectMarks.supersededBy),
        ),
      );
    expect(actifs).toHaveLength(1);
  });

  it("LWW : deuxième upsert supersède le premier", async () => {
    const first = await upsertMark(db, {
      lotVersionId,
      noLot,
      citySlug,
      dimension: "pipeline",
      statut: "favori",
      mode: "real",
      authorId,
    });

    const second = await upsertMark(db, {
      lotVersionId,
      noLot,
      citySlug,
      dimension: "pipeline",
      statut: "sollicite",
      mode: "real",
      authorId,
    });

    // Chaîne vérifiée
    expect(second.supersedes).toBe(first.id);
    expect(second.supersededBy).toBeNull();

    // first est maintenant supersedé
    const firstInDb = await db
      .select({ supersededBy: prospectMarks.supersededBy })
      .from(prospectMarks)
      .where(eq(prospectMarks.id, first.id))
      .limit(1);
    expect(firstInDb[0]?.supersededBy).toBe(second.id);

    // Un seul actif
    const actifs = await db
      .select()
      .from(prospectMarks)
      .where(
        and(
          eq(prospectMarks.lotVersionId, lotVersionId),
          eq(prospectMarks.dimension, "pipeline"),
          isNull(prospectMarks.supersededBy),
        ),
      );
    expect(actifs).toHaveLength(1);
    expect(actifs[0]?.statut).toBe("sollicite");
  });

  it("les deux dimensions sont indépendantes (pipeline ⊥ marche)", async () => {
    await upsertMark(db, {
      lotVersionId,
      noLot,
      citySlug,
      dimension: "pipeline",
      statut: "favori",
      mode: "real",
      authorId,
    });
    await upsertMark(db, {
      lotVersionId,
      noLot,
      citySlug,
      dimension: "marche",
      statut: "en_vente",
      mode: "real",
      authorId,
    });

    // Deux marquages actifs simultanés (dimensions orthogonales)
    const actifs = await db
      .select()
      .from(prospectMarks)
      .where(
        and(
          eq(prospectMarks.lotVersionId, lotVersionId),
          isNull(prospectMarks.supersededBy),
        ),
      );
    expect(actifs).toHaveLength(2);
  });
});

// ─── Tests notes ──────────────────────────────────────────────────────────────

describe("addNote — append-only", () => {
  it("insère une note et retourne la ligne créée", async () => {
    const note = await addNote(db, {
      noLot,
      citySlug,
      authorId,
      body: "Premier contact établi",
      mode: "real",
    });

    expect(note.id).toBeTruthy();
    expect(note.body).toBe("Premier contact établi");
  });

  it("deux notes = deux lignes (jamais d'écrasement)", async () => {
    await addNote(db, { noLot, citySlug, authorId, body: "Note 1", mode: "real" });
    await addNote(db, { noLot, citySlug, authorId, body: "Note 2", mode: "real" });

    const notes = await db
      .select()
      .from(prospectNotes)
      .where(
        and(
          eq(prospectNotes.noLot, noLot),
          eq(prospectNotes.citySlug, citySlug),
        ),
      );
    expect(notes).toHaveLength(2);
  });
});

// ─── Tests batch ──────────────────────────────────────────────────────────────

describe("batchUpsertMarks — idempotence", () => {
  it("marque plusieurs lots en une passe", async () => {
    // Créer un deuxième lot
    const noLot2 = `TEST-LOT2-${Date.now()}`;
    const [lot2] = await db
      .insert(lotVersions)
      .values({
        canonicalId: `test-canonical2-${Date.now()}`,
        noLot: noLot2,
        citySlug,
        reconStatus: "validated",
        validFrom: "2024-01-01",
        knownFrom: new Date(),
        rawRef: "test-ref2",
      })
      .returning({ id: lotVersions.id });
    const lotVersionId2 = lot2!.id;

    const result = await batchUpsertMarks(db, {
      lotVersionIds: [lotVersionId, lotVersionId2],
      lotMeta: {
        [lotVersionId]: { noLot, citySlug },
        [lotVersionId2]: { noLot: noLot2, citySlug },
      },
      dimension: "pipeline",
      statut: "favori",
      mode: "real",
      authorId,
    });

    expect(result.created).toBe(2);
    expect(result.lots).toHaveLength(2);
  });

  it("idempotence : rejouer le batch → même état (1 actif par lot)", async () => {
    const input = {
      lotVersionIds: [lotVersionId],
      lotMeta: { [lotVersionId]: { noLot, citySlug } },
      dimension: "pipeline" as const,
      statut: "favori" as const,
      mode: "real" as const,
      authorId,
    };

    await batchUpsertMarks(db, input);
    await batchUpsertMarks(db, input);

    const actifs = await db
      .select()
      .from(prospectMarks)
      .where(
        and(
          eq(prospectMarks.lotVersionId, lotVersionId),
          eq(prospectMarks.dimension, "pipeline"),
          isNull(prospectMarks.supersededBy),
        ),
      );
    expect(actifs).toHaveLength(1);
    // Total = 2 lignes, 1 active
    const total = await db
      .select()
      .from(prospectMarks)
      .where(eq(prospectMarks.lotVersionId, lotVersionId));
    expect(total).toHaveLength(2);
  });
});

// ─── Tests journalisation PII ──────────────────────────────────────────────────

describe("getActiveContactWithLog — journalisation Loi 25", () => {
  it("journalise l'accès au contact dans prospect_contact_access_log", async () => {
    // Créer un contact
    const [contact] = await db
      .insert(prospectContacts)
      .values({
        noLot,
        citySlug,
        proprietaireNom: "Dupont",
        authorId,
      })
      .returning({ id: prospectContacts.id });
    const contactId = contact!.id;

    // Lire avec journalisation
    const result = await getActiveContactWithLog(
      db,
      noLot,
      citySlug,
      authorId,
      "view",
      { endpoint: "/api/v1/prospects/contacts/TEST/test", ip: "127.0.0.1" },
    );

    expect(result?.id).toBe(contactId);

    // Vérifier que l'accès est journalisé
    const logs = await db
      .select()
      .from(prospectContactAccessLog)
      .where(eq(prospectContactAccessLog.contactId, contactId));

    expect(logs).toHaveLength(1);
    expect(logs[0]?.accessorId).toBe(authorId);
    expect(logs[0]?.action).toBe("view");
  });
});

// ─── Tests annotations §2 (target_type / cycle de vie / durabilité) ──────────

describe("annotations §2 — target_type, édition/suppression, durabilité", () => {
  it("0-backfill : une note lot (target_type par défaut) est lisible + attribuée", async () => {
    await addNote(db, { targetType: "lot", noLot, citySlug, authorId, body: "Note lot", mode: "real" });
    const notes = await listNotes(db, { targetType: "lot", noLot, citySlug });
    expect(notes).toHaveLength(1);
    expect(notes[0]?.body).toBe("Note lot");
    expect(notes[0]?.targetType).toBe("lot");
    expect(notes[0]?.authorId).toBe(authorId);
    expect(notes[0]?.authorName).toBe("Test Inc2"); // attribution visible (§3.2)
  });

  it("ancre lot : no_lot/city_slug requis (CHECK chk_prospect_notes_anchor)", async () => {
    await expect(
      addNote(db, { targetType: "lot", noLot: null, citySlug: null, authorId, body: "sans ancre", mode: "real" }),
    ).rejects.toThrow();
  });

  it("édition IN-PLACE author-only : l'auteur édite (updated_at avance), un autre → forbidden", async () => {
    const note = await addNote(db, { targetType: "lot", noLot, citySlug, authorId, body: "v1", mode: "real" });
    expect(note.updatedAt).toBeNull(); // jamais éditée

    const edited = await editNote(db, note.id, authorId, "v2");
    expect(edited.status).toBe("ok");
    if (edited.status === "ok") {
      expect(edited.note.body).toBe("v2");
      expect(edited.note.updatedAt).not.toBeNull(); // éditée
      expect(edited.note.createdAt.getTime()).toBe(note.createdAt.getTime()); // created_at immuable
    }

    // Autre auteur (même email de test, sub distinct) → forbidden (403)
    const [other] = await db.insert(accountUsers).values({
      sub: `test-inc2-other-${Date.now()}`, email: "test-inc2@example.com", name: "Other", status: "approved", isAdmin: false,
    }).returning({ id: accountUsers.id });
    const denied = await editNote(db, note.id, other!.id, "hack");
    expect(denied.status).toBe("forbidden");
  });

  it("soft-delete author-only : suppression invisible en lecture ; un autre → forbidden", async () => {
    const note = await addNote(db, { targetType: "lot", noLot, citySlug, authorId, body: "à supprimer", mode: "real" });

    const [other] = await db.insert(accountUsers).values({
      sub: `test-inc2-o2-${Date.now()}`, email: "test-inc2@example.com", name: "Other2", status: "approved", isAdmin: false,
    }).returning({ id: accountUsers.id });
    expect((await softDeleteNote(db, note.id, other!.id)).status).toBe("forbidden");

    const del = await softDeleteNote(db, note.id, authorId);
    expect(del.status).toBe("ok");

    // Invisible en lecture (deleted_at IS NULL filtré)
    expect(await listNotes(db, { targetType: "lot", noLot, citySlug })).toHaveLength(0);

    // Ré-supprimer une note déjà supprimée → not_found
    expect((await softDeleteNote(db, note.id, authorId)).status).toBe("not_found");
  });

  it("durabilité signal : ON DELETE SET NULL — supprimer le signal ne perd PAS la note (signal_id → NULL)", async () => {
    // Fixture source → ingestion → document → signal.
    const [src] = await db.insert(sources).values({ kind: "test", url: `https://test/${Date.now()}` }).returning({ id: sources.id });
    const [ing] = await db.insert(ingestions).values({ sourceId: src!.id }).returning({ id: ingestions.id });
    const [doc] = await db.insert(documents).values({ ingestionId: ing!.id, s3Key: `k/${Date.now()}`, sha256: "0".repeat(64) }).returning({ id: documents.id });
    const [sig] = await db.insert(signals).values({ documentId: doc!.id, kind: "zonage", summary: "test signal" }).returning({ id: signals.id });

    // Note ancrée signal SANS contexte lot (no_lot/city_slug NULL) — le cas exact
    // du bug CHECK × SET NULL : la branche signal du CHECK est INCONDITIONNELLE.
    const note = await addNote(db, { targetType: "signal", signalId: sig!.id, authorId, body: "note signal", mode: "real" });
    expect(note.signalId).toBe(sig!.id);
    expect(note.targetType).toBe("signal");

    // Supprimer le signal → SET NULL ne doit ni violer le CHECK ni perdre la note.
    await db.delete(signals).where(eq(signals.id, sig!.id));

    const [survived] = await db.select().from(prospectNotes).where(eq(prospectNotes.id, note.id)).limit(1);
    expect(survived).toBeTruthy();          // la note SURVIT
    expect(survived?.signalId).toBeNull();  // dégradée en NULL, 0 perte (§3.1)

    // Cleanup (la note est purgée au prochain beforeEach ; source cascade doc/ingestion).
    await db.delete(prospectNotes).where(eq(prospectNotes.id, note.id));
    await db.delete(sources).where(eq(sources.id, src!.id));
  });
});
