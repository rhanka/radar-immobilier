import { createS3BlobStore } from "@sentropic/artifacts/adapters/s3";
import { createMemoryBlobStore } from "@sentropic/artifacts/server/publication";

export function createTestMemoryBlobStore() {
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
