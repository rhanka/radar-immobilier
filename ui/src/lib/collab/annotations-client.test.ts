/**
 * annotations-client — test unitaire (mock `fetchWithTimeout`). Vérifie le wire
 * snake_case, l'endpoint unifié, le mapping auteur plat (GET) ET imbriqué
 * (POST/PATCH), et surtout que l'init fetch est passé sous `opts.init` (la SEULE
 * forme que `fetchWithTimeout` forwarde à `fetch` — co-val i-arch #581).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("$lib/net/fetch-with-timeout.js", () => ({
  fetchWithTimeout: vi.fn(),
}));

import { fetchWithTimeout } from "$lib/net/fetch-with-timeout.js";
import {
  listAnnotations,
  createAnnotation,
  editAnnotation,
  deleteAnnotation,
} from "./annotations-client.js";
import type { AnnotationTarget } from "./annotation.js";

const ft = fetchWithTimeout as unknown as ReturnType<typeof vi.fn>;

function okJson(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

/** init fetch réellement forwardé = `opts.init` (2e arg de fetchWithTimeout). */
function initOf(callIndex = 0): RequestInit {
  return (ft.mock.calls[callIndex]![1] as { init: RequestInit }).init;
}

const SIGNAL: AnnotationTarget = { type: "signal", id: "sig-1", citySlug: "delson" };
const LOT: AnnotationTarget = { type: "lot", id: "1234567", citySlug: "delson" };

beforeEach(() => ft.mockReset());

describe("annotations-client", () => {
  it("listAnnotations(signal) : GET endpoint unifié + query snake_case + init.credentials", async () => {
    ft.mockResolvedValueOnce(okJson({ ok: true, notes: [] }));
    await listAnnotations(SIGNAL);
    const url = ft.mock.calls[0]![0] as string;
    expect(url).toContain("/api/v1/prospects/notes?");
    expect(url).toContain("target_type=signal");
    expect(url).toContain("signal_id=sig-1");
    expect(url).not.toContain("city_slug"); // signal = ancre signal_id seule
    expect(initOf().credentials).toBe("same-origin");
  });

  it("listAnnotations(lot) : query no_lot + city_slug", async () => {
    ft.mockResolvedValueOnce(okJson({ ok: true, notes: [] }));
    await listAnnotations(LOT);
    const url = ft.mock.calls[0]![0] as string;
    expect(url).toContain("target_type=lot");
    expect(url).toContain("no_lot=1234567");
    expect(url).toContain("city_slug=delson");
  });

  it("mappe l'auteur À PLAT (GET) : authorName puis authorEmail", async () => {
    ft.mockResolvedValueOnce(
      okJson({
        ok: true,
        notes: [
          { id: "n1", body: "a", authorId: "u1", authorName: "Alice", createdAt: "2026-01-01T00:00:00Z" },
          { id: "n2", body: "b", authorId: "u2", authorName: null, authorEmail: "bob@x.io", createdAt: "2026-01-02T00:00:00Z" },
        ],
      }),
    );
    const notes = await listAnnotations(SIGNAL);
    expect(notes[0]!.authorName).toBe("Alice");
    expect(notes[1]!.authorName).toBe("bob@x.io");
    expect(notes[0]!.authorId).toBe("u1");
  });

  it("mappe l'auteur IMBRIQUÉ (POST/PATCH shape) aussi", async () => {
    ft.mockResolvedValueOnce(
      okJson({ ok: true, notes: [{ id: "n3", body: "c", author: { id: "u3", name: "Carol" }, createdAt: "2026-01-03T00:00:00Z" }] }),
    );
    const notes = await listAnnotations(SIGNAL);
    expect(notes[0]!.authorName).toBe("Carol");
    expect(notes[0]!.authorId).toBe("u3");
  });

  it("createAnnotation(signal) : POST sous init, body snake_case, pas d'authorId auto", async () => {
    ft.mockResolvedValueOnce(okJson({ ok: true, note: {} }));
    await createAnnotation(SIGNAL, "  note  ");
    const url = ft.mock.calls[0]![0] as string;
    const init = initOf();
    expect(url).toContain("/api/v1/prospects/notes");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    const payload = JSON.parse(init.body as string);
    expect(payload).toEqual({ target_type: "signal", signal_id: "sig-1", body: "  note  " });
    expect(payload.authorId).toBeUndefined();
  });

  it("createAnnotation(lot) : no_lot + city_slug (sous init.body)", async () => {
    ft.mockResolvedValueOnce(okJson({ ok: true }));
    await createAnnotation(LOT, "x");
    const payload = JSON.parse(initOf().body as string);
    expect(payload).toEqual({ target_type: "lot", no_lot: "1234567", city_slug: "delson", body: "x" });
  });

  it("editAnnotation : PATCH sous init, /:id, body { body }", async () => {
    ft.mockResolvedValueOnce(okJson({ ok: true }));
    await editAnnotation("n1", "corrigé");
    const url = ft.mock.calls[0]![0] as string;
    const init = initOf();
    expect(url).toContain("/api/v1/prospects/notes/n1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ body: "corrigé" });
  });

  it("deleteAnnotation : DELETE sous init, /:id", async () => {
    ft.mockResolvedValueOnce(okJson({ ok: true }));
    await deleteAnnotation("n1");
    const url = ft.mock.calls[0]![0] as string;
    expect(url).toContain("/api/v1/prospects/notes/n1");
    expect(initOf().method).toBe("DELETE");
  });

  it("propage une erreur HTTP", async () => {
    ft.mockResolvedValueOnce({ ok: false, status: 500 } as unknown as Response);
    await expect(listAnnotations(SIGNAL)).rejects.toThrow(/HTTP 500/);
  });
});
