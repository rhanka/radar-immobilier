import { loadConfig } from "../../config.js";
import { createDb } from "../client.js";
import { retireEmptyLegacyNotes } from "../retire-legacy-notes.js";

const closedWindowRef = process.argv.find((arg) => arg.startsWith("--closed-window-ref="))?.slice("--closed-window-ref=".length);
if (!closedWindowRef?.trim()) throw new Error("Pass --closed-window-ref=<authorized-cutover-reference>");
const { pool } = createDb(loadConfig());
try {
  const deletedNoteCount = await retireEmptyLegacyNotes(pool, { closedWindowRef, migrationsFolder: "drizzle" });
  console.log(JSON.stringify({ status: "retired", deletedNoteCount }));
} finally { await pool.end(); }
