import { createS3BlobStore } from "@sentropic/artifacts/adapters/s3";

type ListableBlobs = { listKeys(prefix: string): Promise<string[]> };

/** Runtime contract shared by every test blob store, including memory doubles. */
export function withTestBlobPrefixes<T extends ListableBlobs>(store: T): T {
  return {
    ...store,
    async listKeys(prefix: string) {
      if (typeof prefix !== "string" || prefix.length === 0 || prefix.includes("..")) {
        throw new Error(`invalid blob prefix: ${String(prefix)}`);
      }
      return store.listKeys(prefix);
    },
  };
}

export function createTestS3BlobStore(options: Parameters<typeof createS3BlobStore>[0]) {
  return withTestBlobPrefixes(createS3BlobStore(options));
}
