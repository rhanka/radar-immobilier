// Synthetic MCP state for browser rendering. Protocol elicitation is covered by the SDK integration suite.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createDb } from "../../api/src/db/client.ts";
import { loadConfig } from "../../api/src/config.ts";
const seed = JSON.parse(readFileSync(`${process.env.E2E_STATE_DIR}/seed.json`, "utf8"));
const { pool } = createDb(loadConfig());
try {
  const signalRef = { workspaceId: seed.workspaceId, scope: "personal", citySlug: seed.city,
    type: "Signal", id: seed.signals[0].id };
  for (const [tool, proposal, validation] of [
    ["classify_signal", { classe: "pertinent", reasonCode: "P-DENSITE", reason: "Residential potential" }, "human"],
    ["annotate_signal", { text: "<b>MCP browser note</b>" }, "auto"],
  ]) {
    const body = JSON.stringify({ signalRef, ...proposal, model: "e2e-mcp-model" });
    const { rows } = await pool.query("SELECT signal_mcp_read($1,$2::jsonb) AS state", ["e2e-synthetic-member", JSON.stringify(signalRef)]);
    const saved = await pool.query("SELECT signal_mcp_write($1,'e2e-client',$2,$3::jsonb,$4,$5,$6) AS result",
      ["e2e-synthetic-member", tool, body, validation, rows[0].state.version, createHash("sha256").update(body).digest("hex")]);
    if (saved.rows[0].result.error) throw new Error(saved.rows[0].result.error);
  }
  console.log("[mcp-browser-seed] classification and note persisted");
} finally { await pool.end(); }
