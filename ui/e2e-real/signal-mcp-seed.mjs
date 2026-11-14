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
    ["classify_signal", { classe: "pertinent", reasonCode: "P-DENSITE", reason: "Residential potential", pendingHuman: true }, "auto"],
    ["annotate_signal", { text: "<b>MCP browser note</b>" }, "auto"],
  ]) {
    const body = JSON.stringify({ signalRef, ...proposal, model: "e2e-mcp-model" });
    const { rows } = await pool.query("SELECT signal_mcp_read($1,$2::jsonb) AS state", ["e2e-synthetic-member", JSON.stringify(signalRef)]);
    const saved = await pool.query("SELECT signal_mcp_write($1,'e2e-client',$2,$3::jsonb,$4,$5,$6) AS result",
      ["e2e-synthetic-member", tool, body, validation, rows[0].state.version, createHash("sha256").update(body).digest("hex")]);
    if (saved.rows[0].result.error) throw new Error(saved.rows[0].result.error);
  }
  const secondRef = { ...signalRef, id: seed.signals[1].id };
  const { rows } = await pool.query("SELECT signal_mcp_read($1,$2::jsonb) AS state", ["e2e-synthetic-member", JSON.stringify(secondRef)]);
  const secondBody = JSON.stringify({ signalRef: secondRef, classe: "pertinent", reasonCode: "P-DENSITE",
    reason: "Residential potential", pendingHuman: true, model: "e2e-mcp-model" });
  const second = await pool.query("SELECT signal_mcp_write($1,'e2e-client','classify_signal',$2::jsonb,'auto',$3,$4) AS result",
    ["e2e-synthetic-member", secondBody, rows[0].state.version, createHash("sha256").update(secondBody).digest("hex")]);
  if (second.rows[0].result.error) throw new Error(second.rows[0].result.error);
  console.log("[mcp-browser-seed] classification and note persisted");
} finally { await pool.end(); }
