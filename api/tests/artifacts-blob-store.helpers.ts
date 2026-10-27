import { createS3BlobStore } from "@sentropic/artifacts/adapters/s3";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

/** The published memory double has no package subpath export. */
export async function createTestMemoryBlobStore() {
  const migration = createRequire(import.meta.url).resolve("@sentropic/artifacts/migrations/0003_coordinator.sql");
  const { createMemoryBlobStore } = await import(new URL("../dist/server/publication.js", pathToFileURL(migration)).href) as {
    createMemoryBlobStore: () => ReturnType<typeof createS3BlobStore>;
  };
  return createMemoryBlobStore();
}

export function createTestS3BlobStore(options: Parameters<typeof createS3BlobStore>[0]) {
  const store = createS3BlobStore(options);
  const pending = new Map<string, { writer: Promise<void>; all: Promise<void> }>();
  // S3mock can truncate a GET body while the same key is being overwritten.
  // Keep writes exclusive while preserving concurrent reads and independent keys.
  function atomic<T>(key: string, operation: () => Promise<T>, write = false): Promise<T> {
    const prior = pending.get(key) ?? { writer: Promise.resolve(), all: Promise.resolve() };
    const result = (write ? prior.all : prior.writer).then(operation);
    const tail = result.then(() => {}, () => {});
    const all = Promise.all([prior.all, tail]).then(() => {});
    pending.set(key, { writer: write ? all : prior.writer, all });
    void all.then(() => { if (pending.get(key)?.all === all) pending.delete(key); });
    return result;
  }
  return {
    ...store,
    putBlob: (...args: Parameters<typeof store.putBlob>) => atomic(args[0], () => store.putBlob(...args), true),
    getBlob: (...args: Parameters<typeof store.getBlob>) => atomic(args[0], () => store.getBlob(...args)),
    deleteBlob: (...args: Parameters<typeof store.deleteBlob>) => atomic(args[0], () => store.deleteBlob(...args), true),
  };
}
