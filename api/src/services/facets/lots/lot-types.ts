import type { Database } from "../../../db/client.js";

export type LotTx = Parameters<Parameters<Database["transaction"]>[0]>[0];
