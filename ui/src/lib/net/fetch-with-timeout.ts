/**
 * fetch-with-timeout — borne chaque requête réseau dans le temps ET la relie à
 * un `AbortSignal` externe (annulation « anti-course » au changement de ville).
 *
 * Motivation (bug vues carte) : les couches carte (aplats zones, aplats lots,
 * contenu signaux du panneau droit) partaient en parallèle SANS borne de temps
 * ni annulation. Une requête qui « pend » laissait un waiter tourner
 * indéfiniment (blanc silencieux), et une réponse en retard de la ville
 * précédente pouvait peindre la mauvaise ville. Ce wrapper apporte :
 *
 *  1. TIMEOUT : au-delà de `timeoutMs`, la requête est avortée et le wrapper
 *     lève une `RequestTimeoutError` (état d'erreur HONNÊTE de la couche, pas un
 *     spinner éternel).
 *  2. ANNULATION EXTERNE : un `signal` fourni par l'appelant (typiquement le
 *     `AbortController` de la sélection de ville courante) avorte la requête ;
 *     le wrapper RELÈVE alors l'`AbortError` telle quelle pour que l'appelant la
 *     distingue d'un timeout (réponse périmée → à IGNORER, pas à afficher).
 *
 * Le wrapper ne masque JAMAIS un timeout en abort ni l'inverse : la
 * distinction pilote la copy client (« Indisponible » vs simple ignore).
 */

/** Délai par défaut avant qu'une requête carte soit considérée en échec. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

/** Levée quand une requête dépasse `timeoutMs` (distincte d'un abort externe). */
export class RequestTimeoutError extends Error {
  readonly url: string;
  readonly timeoutMs: number;
  constructor(url: string, timeoutMs: number) {
    super(`request timeout after ${timeoutMs}ms: ${url}`);
    this.name = "RequestTimeoutError";
    this.url = url;
    this.timeoutMs = timeoutMs;
  }
}

export interface FetchWithTimeoutOptions {
  /** Signal externe (annulation anti-course). Combiné au timeout interne. */
  signal?: AbortSignal;
  /** Délai max avant échec (ms). Défaut : `DEFAULT_REQUEST_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** Init `fetch` additionnel (headers, method…). `signal` y est ignoré. */
  init?: Omit<RequestInit, "signal">;
}

/** `true` si l'erreur est une annulation (abort externe), pas un timeout. */
export function isAbortError(err: unknown): boolean {
  return (
    err instanceof DOMException
      ? err.name === "AbortError"
      : err instanceof Error && err.name === "AbortError"
  );
}

/**
 * `fetch` borné dans le temps et relié à un signal externe.
 *
 * - Timeout interne dépassé → `RequestTimeoutError`.
 * - Signal externe avorté → l'`AbortError` d'origine est relevée telle quelle.
 * - Sinon, comportement identique à `fetch` (mêmes `Response`, mêmes erreurs
 *   réseau) : ISO pour le chemin nominal rapide.
 */
export async function fetchWithTimeout(
  url: string,
  opts: FetchWithTimeoutOptions = {},
): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const external = opts.signal;
  const controller = new AbortController();

  // Si le signal externe est déjà avorté, on court-circuite immédiatement.
  if (external?.aborted) {
    throw abortErrorFrom(external);
  }

  let timedOut = false;
  const onExternalAbort = () => controller.abort();
  external?.addEventListener("abort", onExternalAbort, { once: true });

  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, { ...opts.init, signal: controller.signal });
  } catch (err) {
    // Un abort peut provenir du timeout OU du signal externe. On lève l'erreur
    // qui reflète la VRAIE cause pour piloter la copy client honnêtement.
    if (timedOut) throw new RequestTimeoutError(url, timeoutMs);
    if (external?.aborted) throw abortErrorFrom(external);
    throw err;
  } finally {
    clearTimeout(timeoutId);
    external?.removeEventListener("abort", onExternalAbort);
  }
}

function abortErrorFrom(signal: AbortSignal): Error {
  const reason = (signal as { reason?: unknown }).reason;
  if (reason instanceof Error) return reason;
  const err = new Error("The operation was aborted.");
  err.name = "AbortError";
  return err;
}
