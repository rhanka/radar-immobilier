import type pg from "pg";
import { createPostgresCommitExecutor } from "@sentropic/artifacts/adapters/postgres-commit";
import { createPostgresDeletionClaimStore } from "@sentropic/artifacts/server/gc";
import { scheduleBoundedPreparationCleanup } from "@sentropic/artifacts/server/object-intents";
import type { PublicationBlobStore } from "@sentropic/artifacts/server/publication";
import type { createPostgresArtifactStore } from "@sentropic/artifacts/adapters/postgres";

/** Serialize bounded sweeps; durable intent deadlines survive a process restart. */
export function startPreparationCleanup(pool: pg.Pool, store: ReturnType<typeof createPostgresArtifactStore>,
  blobs: PublicationBlobStore, onError?: (error: unknown) => void) {
  const executor = createPostgresCommitExecutor(pool);
  let running: Promise<void> | undefined;
  let failure: unknown;
  const runOnce = (): Promise<void> => {
    if (running) return running;
    running = (async () => {
      const client = await executor.beginFinalization();
      let error: unknown;
      try {
        await client.beginReadCommitted();
        await scheduleBoundedPreparationCleanup({ intents: store, refs: store,
          claims: createPostgresDeletionClaimStore(client), blobs }, Date.now());
        await client.commit();
        failure = undefined;
      } catch (cause) {
        error = cause;
        try { await client.rollback(); } catch (rollbackError) { error = rollbackError; }
        throw cause;
      } finally { client.release(error); }
    })().finally(() => { running = undefined; });
    return running;
  };
  const timer = setInterval(() => { void runOnce().catch((error: unknown) => {
    failure = error;
    console.error(JSON.stringify({ kind: "artifacts.preparation_cleanup_unavailable" }));
    onError?.(error);
  }); }, 1000);
  timer.unref();
  return { runOnce, stop: () => clearInterval(timer), get failure() { return failure; } };
}
