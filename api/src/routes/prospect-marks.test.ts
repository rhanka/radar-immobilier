/**
 * Tests unitaires — routes prospect-marks (Inc 2).
 *
 * Stratégie : vi.mock() sur les services pour éviter de répliquer la logique
 * drizzle dans un faux DB. Les tests vérifient :
 *   - Validation HTTP (400/201/501) et shape des réponses
 *   - Appels corrects aux fonctions de service (append-only, LWW, batch)
 *   - Emission SSE (stream-bus publié)
 *   - Stub contact (501)
 *
 * Les tests de logique append-only/supersedes/idempotence sont dans le test
 * d'intégration (tests/integration/prospect-marks.spec.ts).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { prospectMarksRoute } from "./prospect-marks.js";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock stream-bus publish (ne pas envoyer de vraies frames SSE)
vi.mock("../services/chat/stream-bus.js", () => ({
  publish: vi.fn().mockResolvedValue({ streamId: "prospect-marks", type: "test", sequence: 0, data: {} }),
}));

// Mock marks-service
vi.mock("../services/prospect/marks-service.js", () => ({
  upsertMark: vi.fn().mockResolvedValue({
    id: "mark-id-1",
    lotVersionId: "11111111-1111-1111-1111-111111111111",
    noLot: "1234567",
    citySlug: "test-ville",
    dimension: "pipeline",
    statut: "favori",
    mode: "real",
    authorId: "22222222-2222-2222-2222-222222222222",
    supersedes: null,
    supersededBy: null,
    prixDemande: null,
    lienAnnonce: null,
    createdAt: new Date("2024-01-01"),
  }),
  addNote: vi.fn().mockResolvedValue({
    id: "note-id-1",
    targetType: "lot",
    noLot: "1234567",
    citySlug: "test-ville",
    signalId: null,
    authorId: "22222222-2222-2222-2222-222222222222",
    body: "Premier contact pris",
    mode: "real",
    tenantId: "default",
    createdAt: new Date("2024-01-01"),
    updatedAt: null,
    deletedAt: null,
  }),
  editNote: vi.fn().mockResolvedValue({
    status: "ok",
    note: {
      id: "note-id-1", targetType: "lot", noLot: "1234567", citySlug: "test-ville",
      signalId: null, authorId: "22222222-2222-2222-2222-222222222222",
      body: "édité", mode: "real", tenantId: "default",
      createdAt: new Date("2024-01-01"), updatedAt: new Date("2024-01-02"), deletedAt: null,
    },
  }),
  softDeleteNote: vi.fn().mockResolvedValue({
    status: "ok",
    note: {
      id: "note-id-1", targetType: "lot", noLot: "1234567", citySlug: "test-ville",
      signalId: null, authorId: "22222222-2222-2222-2222-222222222222",
      body: "x", mode: "real", tenantId: "default",
      createdAt: new Date("2024-01-01"), updatedAt: null, deletedAt: new Date("2024-01-03"),
    },
  }),
  listNotes: vi.fn().mockResolvedValue([]),
  batchUpsertMarks: vi.fn().mockResolvedValue({
    created: 2,
    lots: [
      { noLot: "LOT-A", citySlug: "ville-test", markId: "mark-a" },
      { noLot: "LOT-B", citySlug: "ville-test", markId: "mark-b" },
    ],
  }),
  getActiveMarksForLot: vi.fn().mockResolvedValue([]),
  getActiveMarksForZone: vi.fn().mockResolvedValue([]),
  getNotesForLot: vi.fn().mockResolvedValue([]),
}));

// ─── Constantes de test ───────────────────────────────────────────────────────

const _VALID_LOT_VERSION_ID = "11111111-1111-1111-1111-111111111111";
const _VALID_AUTHOR_ID = "22222222-2222-2222-2222-222222222222";

// Mock DB minimal (utilisé pour les requêtes auth — en open mode jamais appelé)
const mockDb = {
  select: vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([]),
      }),
    }),
  }),
  insert: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
} as unknown as Parameters<typeof prospectMarksRoute>[0]["db"];

// Mock drizzle operators (utilisés dans la route directement pour GET lotVersionId)
vi.mock("../db/schema.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/schema.js")>();
  return actual;
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeApp() {
  return prospectMarksRoute({ db: mockDb });
}

// ─── Tests POST /marks ────────────────────────────────────────────────────────

describe("POST /api/v1/prospects/marks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retourne 400 si le body est invalide", async () => {
    const app = makeApp();
    const res = await app.request("/api/v1/prospects/marks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ noLot: "ABC" }),
    });
    expect(res.status).toBe(400);
  });

  it("retourne 400 si authorId manque (open mode)", async () => {
    const app = makeApp();
    const res = await app.request("/api/v1/prospects/marks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        lotVersionId: "11111111-1111-1111-1111-111111111111",
        noLot: "1234567",
        citySlug: "test-ville",
        dimension: "pipeline",
        statut: "favori",
        // authorId absent
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/authorId/);
  });

  it("crée un marquage (201) et retourne le marquage", async () => {
    const { upsertMark } = await import("../services/prospect/marks-service.js");
    const app = makeApp();
    const res = await app.request("/api/v1/prospects/marks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        lotVersionId: "11111111-1111-1111-1111-111111111111",
        noLot: "1234567",
        citySlug: "test-ville",
        dimension: "pipeline",
        statut: "favori",
        authorId: "22222222-2222-2222-2222-222222222222",
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.mark.id).toBe("mark-id-1");
    expect(body.mark.statut).toBe("favori");
    expect(upsertMark).toHaveBeenCalledOnce();
  });

  it("appelle upsertMark avec les bons arguments (append-only LWW serveur)", async () => {
    const { upsertMark } = await import("../services/prospect/marks-service.js");
    const app = makeApp();
    await app.request("/api/v1/prospects/marks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        lotVersionId: "11111111-1111-1111-1111-111111111111",
        noLot: "1234567",
        citySlug: "test-ville",
        dimension: "pipeline",
        statut: "sollicite",
        authorId: "22222222-2222-2222-2222-222222222222",
      }),
    });
    expect(upsertMark).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({
        lotVersionId: "11111111-1111-1111-1111-111111111111",
        statut: "sollicite",
        authorId: "22222222-2222-2222-2222-222222222222",
      }),
    );
  });

  it("dimension marche : accepte prixDemande et lienAnnonce", async () => {
    const { upsertMark } = await import("../services/prospect/marks-service.js");
    const app = makeApp();
    const res = await app.request("/api/v1/prospects/marks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        lotVersionId: "11111111-1111-1111-1111-111111111111",
        noLot: "1234567",
        citySlug: "test-ville",
        dimension: "marche",
        statut: "en_vente",
        prixDemande: 450000,
        lienAnnonce: "https://exemple.ca/annonce/123",
        authorId: "22222222-2222-2222-2222-222222222222",
      }),
    });
    expect(res.status).toBe(201);
    expect(upsertMark).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({
        dimension: "marche",
        statut: "en_vente",
        prixDemande: 450000,
        lienAnnonce: "https://exemple.ca/annonce/123",
      }),
    );
  });

  it("rejette un statut pipeline invalide pour dimension marche", async () => {
    const app = makeApp();
    const res = await app.request("/api/v1/prospects/marks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        lotVersionId: "11111111-1111-1111-1111-111111111111",
        noLot: "1234567",
        citySlug: "test-ville",
        dimension: "marche",
        statut: "favori", // invalide pour marche
        authorId: "22222222-2222-2222-2222-222222222222",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("publie une frame SSE après création", async () => {
    const { publish } = await import("../services/chat/stream-bus.js");
    const app = makeApp();
    await app.request("/api/v1/prospects/marks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        lotVersionId: "11111111-1111-1111-1111-111111111111",
        noLot: "1234567",
        citySlug: "test-ville",
        dimension: "pipeline",
        statut: "favori",
        authorId: "22222222-2222-2222-2222-222222222222",
      }),
    });
    expect(publish).toHaveBeenCalledWith(
      "prospect-marks",
      "prospect:mark",
      expect.objectContaining({ action: "upsert" }),
    );
  });
});

// ─── Tests annotations /notes (§2 — create / edit / delete / list) ───────────

describe("POST /api/v1/prospects/notes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retourne 400 si target_type manquant (union discriminée)", async () => {
    const app = makeApp();
    const res = await app.request("/api/v1/prospects/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ no_lot: "1234567", city_slug: "test-ville", body: "x", authorId: _VALID_AUTHOR_ID }),
    });
    expect(res.status).toBe(400);
  });

  it("crée une note lot — 201 + attribution", async () => {
    const { addNote } = await import("../services/prospect/marks-service.js");
    const app = makeApp();
    const res = await app.request("/api/v1/prospects/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        target_type: "lot",
        no_lot: "1234567",
        city_slug: "test-ville",
        body: "Premier contact pris",
        authorId: _VALID_AUTHOR_ID,
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.note.body).toBe("Premier contact pris");
    expect(body.note.author).toBeDefined(); // attribution (§3.2)
    expect(addNote).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({ targetType: "lot", noLot: "1234567", citySlug: "test-ville" }),
    );
  });

  it("crée une note signal — 201 (signal_id mappé)", async () => {
    const { addNote } = await import("../services/prospect/marks-service.js");
    const app = makeApp();
    const res = await app.request("/api/v1/prospects/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        target_type: "signal",
        signal_id: "33333333-3333-3333-3333-333333333333",
        body: "note signal",
        authorId: _VALID_AUTHOR_ID,
      }),
    });
    expect(res.status).toBe(201);
    expect(addNote).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({ targetType: "signal", signalId: "33333333-3333-3333-3333-333333333333" }),
    );
  });

  it("note signal sans signal_id → 400 (enforce applicatif)", async () => {
    const app = makeApp();
    const res = await app.request("/api/v1/prospects/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target_type: "signal", body: "x", authorId: _VALID_AUTHOR_ID }),
    });
    expect(res.status).toBe(400);
  });

  it("publie une frame SSE 'add'", async () => {
    const { publish } = await import("../services/chat/stream-bus.js");
    const app = makeApp();
    await app.request("/api/v1/prospects/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        target_type: "lot",
        no_lot: "1234567",
        city_slug: "test-ville",
        body: "Deuxième note",
        authorId: _VALID_AUTHOR_ID,
      }),
    });
    expect(publish).toHaveBeenCalledWith(
      "prospect-marks",
      "prospect:note",
      expect.objectContaining({ action: "add" }),
    );
  });
});

describe("PATCH /api/v1/prospects/notes/:id — édition author-only", () => {
  const NOTE_ID = "99999999-9999-9999-9999-999999999999";
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("édite (200) — action SSE 'edit'", async () => {
    const { publish } = await import("../services/chat/stream-bus.js");
    const app = makeApp();
    const res = await app.request(`/api/v1/prospects/notes/${NOTE_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "corrigé", authorId: _VALID_AUTHOR_ID }),
    });
    expect(res.status).toBe(200);
    expect(publish).toHaveBeenCalledWith(
      "prospect-marks",
      "prospect:note",
      expect.objectContaining({ action: "edit" }),
    );
  });

  it("403 si un autre auteur édite (author-only)", async () => {
    const { editNote } = await import("../services/prospect/marks-service.js");
    (editNote as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ status: "forbidden" });
    const app = makeApp();
    const res = await app.request(`/api/v1/prospects/notes/${NOTE_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "hack", authorId: "44444444-4444-4444-4444-444444444444" }),
    });
    expect(res.status).toBe(403);
  });

  it("404 si la note est absente/supprimée", async () => {
    const { editNote } = await import("../services/prospect/marks-service.js");
    (editNote as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ status: "not_found" });
    const app = makeApp();
    const res = await app.request(`/api/v1/prospects/notes/${NOTE_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "x", authorId: _VALID_AUTHOR_ID }),
    });
    expect(res.status).toBe(404);
  });

  it("400 si id non-UUID", async () => {
    const app = makeApp();
    const res = await app.request("/api/v1/prospects/notes/not-a-uuid", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "x", authorId: _VALID_AUTHOR_ID }),
    });
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/v1/prospects/notes/:id — soft-delete author-only", () => {
  const NOTE_ID = "99999999-9999-9999-9999-999999999999";
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("supprime (200) — action SSE 'delete'", async () => {
    const { publish } = await import("../services/chat/stream-bus.js");
    const app = makeApp();
    const res = await app.request(`/api/v1/prospects/notes/${NOTE_ID}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ authorId: _VALID_AUTHOR_ID }),
    });
    expect(res.status).toBe(200);
    expect(publish).toHaveBeenCalledWith(
      "prospect-marks",
      "prospect:note",
      expect.objectContaining({ action: "delete" }),
    );
  });

  it("403 si un autre auteur supprime", async () => {
    const { softDeleteNote } = await import("../services/prospect/marks-service.js");
    (softDeleteNote as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ status: "forbidden" });
    const app = makeApp();
    const res = await app.request(`/api/v1/prospects/notes/${NOTE_ID}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ authorId: "44444444-4444-4444-4444-444444444444" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("GET /api/v1/prospects/notes — lecture unifiée", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("200 pour target_type=lot", async () => {
    const app = makeApp();
    const res = await app.request("/api/v1/prospects/notes?target_type=lot&no_lot=1234567&city_slug=test-ville");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.notes)).toBe(true);
  });

  it("400 pour query invalide (target_type manquant)", async () => {
    const app = makeApp();
    const res = await app.request("/api/v1/prospects/notes?no_lot=1234567");
    expect(res.status).toBe(400);
  });
});

// ─── Tests POST /marks/batch ──────────────────────────────────────────────────

describe("POST /api/v1/prospects/marks/batch", () => {
  const LOT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const LOT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marque tous les lots de la zone (1 acte = 1 frame SSE)", async () => {
    const { batchUpsertMarks } = await import("../services/prospect/marks-service.js");
    const { publish } = await import("../services/chat/stream-bus.js");
    const app = makeApp();

    const res = await app.request("/api/v1/prospects/marks/batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        lotVersionIds: [LOT_A, LOT_B],
        lotMeta: {
          [LOT_A]: { noLot: "LOT-A", citySlug: "ville-test" },
          [LOT_B]: { noLot: "LOT-B", citySlug: "ville-test" },
        },
        dimension: "pipeline",
        statut: "favori",
        authorId: "22222222-2222-2222-2222-222222222222",
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.created).toBe(2);

    // 1 seul appel au service (pas N appels)
    expect(batchUpsertMarks).toHaveBeenCalledOnce();

    // 1 seule frame SSE (idempotent, 1 acte = 1 frame)
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(
      "prospect-marks",
      "prospect:batch",
      expect.objectContaining({ action: "batch_upsert", created: 2 }),
    );
  });

  it("retourne 400 si lotVersionIds vide", async () => {
    const app = makeApp();
    const res = await app.request("/api/v1/prospects/marks/batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        lotVersionIds: [],
        lotMeta: {},
        dimension: "pipeline",
        statut: "favori",
        authorId: "22222222-2222-2222-2222-222222222222",
      }),
    });
    expect(res.status).toBe(400);
  });
});

// ─── Tests GET endpoints ──────────────────────────────────────────────────────

describe("GET endpoints", () => {
  it("GET /api/v1/prospects/zones/:citySlug/marks retourne 200", async () => {
    const app = makeApp();
    const res = await app.request("/api/v1/prospects/zones/test-ville/marks");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.marks)).toBe(true);
  });

  it("GET /api/v1/prospects/lots/:noLot/:citySlug/notes retourne 200", async () => {
    const app = makeApp();
    const res = await app.request("/api/v1/prospects/lots/1234567/test-ville/notes");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.notes)).toBe(true);
  });

  it("GET /api/v1/prospects/lots/:noLot/:citySlug/marks retourne 200", async () => {
    const app = makeApp();
    const res = await app.request("/api/v1/prospects/lots/1234567/test-ville/marks");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("GET /api/v1/prospects/contacts/:noLot/:citySlug retourne 501 (stub Inc 3)", async () => {
    const app = makeApp();
    const res = await app.request("/api/v1/prospects/contacts/1234567/test-ville");
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.error).toBe("not_implemented");
    expect(body.inc).toBe(3);
  });

  it("GET /api/v1/prospects/lots/:lotVersionId/marks retourne 400 si UUID invalide", async () => {
    const app = makeApp();
    const res = await app.request("/api/v1/prospects/lots/not-a-uuid/marks");
    expect(res.status).toBe(400);
  });
});
