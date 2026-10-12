import { loadConfig } from "../../config.js";
import { createDb } from "../client.js";
import { retireEmptyLegacyNotes } from "../retire-legacy-notes.js";

const { pool } = createDb(loadConfig());
try {
  const deletedNoteCount = await retireEmptyLegacyNotes(pool);
  console.log(JSON.stringify({ status: "retired", deletedNoteCount }));
} finally { await pool.end(); }
