import { loadConfig } from "../../src/config.js";
import { createDb } from "../../src/db/client.js";
import { createBasketReadOperation } from "../../src/artifacts/reader-baskets.js";
import { resolveReaderCursorKeyring } from "../../src/artifacts/reader-cursor-keyring.js";
import type { ApiReaderContext } from "../../src/artifacts/reader-context.js";
import type { ObjectStore } from "../../src/storage/object-store.js";

// Fresh OS process: no in-memory keyring, projection or pagination state is inherited.
const input = JSON.parse(process.argv[2]!) as { database: string; sub: string; workspaceId: string; cursor: string };
const { db, pool } = createDb({ ...loadConfig(), POSTGRES_DB: input.database });
try {
  const operation = createBasketReadOperation({ db, store: { head: async () => null } as unknown as ObjectStore,
    classification: { cursorKeyring: resolveReaderCursorKeyring({
      CLASSIFICATION_CURSOR_SECRET: Buffer.alloc(32, 7).toString("base64"), CLASSIFICATION_CURSOR_KEY_ID: "l3-persistent",
    })! } });
  const result = await operation("baskets.search.v1", { workspaceId: input.workspaceId,
    citySlug: "synthetic-city", limit: 1, cursor: input.cursor }, { readerSub: input.sub } as ApiReaderContext);
  process.stdout.write(JSON.stringify(result));
} finally { await pool.end(); }
