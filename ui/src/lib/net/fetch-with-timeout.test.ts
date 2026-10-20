/**
 * Tests fetch-with-timeout — time bound + external cancellation.
 *
 * Covers the 3 properties that fix the map-view bug:
 *  1. nominal path: relays the Response untouched (ISO);
 *  2. timeout exceeded → RequestTimeoutError (explicit error state, not an
 *     endless spinner);
 *  3. external abort → original AbortError rethrown (response to IGNORE,
 *     distinct from a timeout).
 * Plus the body bound of fetchJsonWithTimeout: headers at once but a stalled
 * body still fails with RequestTimeoutError instead of hanging the caller.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  fetchWithTimeout,
  fetchJsonWithTimeout,
  readJsonErrorCode,
  RequestTimeoutError,
  isAbortError,
  DEFAULT_REQUEST_TIMEOUT_MS,
} from "./fetch-with-timeout.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("fetchWithTimeout — chemin nominal", () => {
  it("relaie la Response quand fetch répond avant le timeout", async () => {
    const body = JSON.stringify({ ok: true });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200 })));
    const res = await fetchWithTimeout("/api/x", { timeoutMs: 1000 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("transmet le signal du controller interne à fetch", async () => {
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(init?.signal?.aborted).toBe(false);
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);
    await fetchWithTimeout("/api/x");
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("expose un délai par défaut raisonnable", () => {
    expect(DEFAULT_REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
  });
});

describe("fetchWithTimeout — timeout", () => {
  it("lève RequestTimeoutError quand fetch dépasse timeoutMs", async () => {
    vi.useFakeTimers();
    // fetch qui ne résout jamais tant que son signal n'avorte pas.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const err = new Error("aborted");
              err.name = "AbortError";
              reject(err);
            });
          }),
      ),
    );
    const promise = fetchWithTimeout("/api/slow", { timeoutMs: 5000 });
    // Attache un catch tôt pour éviter un unhandled rejection pendant l'avance.
    const asserted = expect(promise).rejects.toBeInstanceOf(RequestTimeoutError);
    await vi.advanceTimersByTimeAsync(5000);
    await asserted;
  });

  it("le message du timeout porte le délai et l'URL", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const err = new Error("aborted");
              err.name = "AbortError";
              reject(err);
            });
          }),
      ),
    );
    const promise = fetchWithTimeout("/api/geo/x/zones", { timeoutMs: 2000 });
    const asserted: Promise<unknown> = promise.then(
      () => undefined,
      (e: unknown) => e,
    );
    await vi.advanceTimersByTimeAsync(2000);
    const err = await asserted;
    expect(err).toBeInstanceOf(RequestTimeoutError);
    const timeoutErr = err as RequestTimeoutError;
    expect(timeoutErr.message).toContain("2000ms");
    expect(timeoutErr.message).toContain("/api/geo/x/zones");
    expect(timeoutErr.timeoutMs).toBe(2000);
  });
});

describe("fetchWithTimeout — annulation externe (anti-course)", () => {
  it("relève une AbortError quand le signal externe avorte", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const err = new Error("aborted");
              err.name = "AbortError";
              reject(err);
            });
          }),
      ),
    );
    const promise = fetchWithTimeout("/api/x", { signal: controller.signal, timeoutMs: 10_000 });
    controller.abort();
    await expect(promise).rejects.toSatisfy(isAbortError);
  });

  it("court-circuite immédiatement si le signal externe est déjà avorté", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    await expect(
      fetchWithTimeout("/api/x", { signal: controller.signal }),
    ).rejects.toSatisfy(isAbortError);
    // fetch ne doit JAMAIS être appelé sur un signal déjà avorté.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("tells an abort apart from a timeout", () => {
    const abort = new Error("x");
    abort.name = "AbortError";
    expect(isAbortError(abort)).toBe(true);
    expect(isAbortError(new RequestTimeoutError("/x", 1))).toBe(false);
    expect(isAbortError(new Error("plain"))).toBe(false);
  });
});

describe("fetchJsonWithTimeout — stalled body", () => {
  /** Headers at once, body stalled: the stream never closes, like a hung body. */
  function stalledBodyResponse(signal: AbortSignal | null | undefined, status = 200): Response {
    return new Response(
      new ReadableStream({
        start(controller) {
          signal?.addEventListener(
            "abort",
            () => controller.error(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        },
      }),
      { status, headers: { "content-type": "application/json" } },
    );
  }

  function stubStalledBody(status = 200): Promise<void> {
    let notifyBodyRead!: () => void;
    const bodyRead = new Promise<void>((resolve) => { notifyBodyRead = resolve; });
    vi.stubGlobal(
      "fetch",
      async (_url: string, init?: RequestInit) => {
        const response = stalledBodyResponse(init?.signal ?? undefined, status);
        const readJson = response.json.bind(response);
        vi.spyOn(response, "json").mockImplementation(() => {
          notifyBodyRead();
          return readJson();
        });
        return response;
      },
    );
    return bodyRead;
  }

  it("times out when the headers arrive but the body stalls", async () => {
    stubStalledBody();
    await expect(fetchJsonWithTimeout("/api/x", { timeoutMs: 10 })).rejects.toBeInstanceOf(
      RequestTimeoutError,
    );
  });

  it("times out a stalled body on the error path instead of masking the status", async () => {
    stubStalledBody(503);
    await expect(fetchJsonWithTimeout("/api/x", { timeoutMs: 10 })).rejects.toBeInstanceOf(
      RequestTimeoutError,
    );
  });

  it.each([200, 503])("relays an external abort during a stalled %i body", async (status) => {
    const bodyRead = stubStalledBody(status);
    const controller = new AbortController();
    const promise = fetchJsonWithTimeout("/api/x", {
      signal: controller.signal,
      timeoutMs: 10_000,
    });
    await bodyRead;
    const reason = new DOMException("City changed", "AbortError");
    controller.abort(reason);
    await expect(promise).rejects.toBe(reason);
  });

  it("returns status, ok and the parsed body when the body arrives in time", async () => {
    vi.stubGlobal(
      "fetch",
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const res = await fetchJsonWithTimeout<{ ok: boolean }>("/api/x", { timeoutMs: 1000 });
    expect(res.status).toBe(200);
    expect(res.ok).toBe(true);
    expect(res.json).toEqual({ ok: true });
  });

  it("reads an unreadable error body as null instead of masking the status", async () => {
    vi.stubGlobal("fetch", async () => new Response("unavailable", { status: 503 }));
    const res = await fetchJsonWithTimeout("/api/x", { timeoutMs: 1000 });
    expect(res.status).toBe(503);
    expect(res.ok).toBe(false);
    expect(res.json).toBeNull();
    expect(readJsonErrorCode(res.json)).toBeNull();
  });

  it("reads the server error code from a parsed error body", () => {
    expect(readJsonErrorCode({ error: "discarded_signals_unavailable" })).toBe(
      "discarded_signals_unavailable",
    );
    expect(readJsonErrorCode({ error: 42 })).toBeNull();
    expect(readJsonErrorCode(null)).toBeNull();
    expect(readJsonErrorCode("unavailable")).toBeNull();
  });

  it.each([200, 503])("releases the timer and external listener after a %i body", async (status) => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    vi.stubGlobal("fetch", async () => new Response("{}", { status }));
    await fetchJsonWithTimeout("/api/x", { signal: controller.signal });
    expect(vi.getTimerCount()).toBe(0);
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
  });
});
