import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { networkFixture, networkSearch } from "./mcp-signal-search-network-fixture.js";

const execute = promisify(execFile);
const probe = process.env.DELIVERY_PROBE_SCRIPT ?? resolve("../tools/make/artefacts-delivery-probe.sh");

describeDb("operator delivery probe over real MCP and API sockets", () => {
  it.each(["missing", "legacy", "scoped"] as const)(
    "should verify the %s workspace at the API boundary and reject invalid evidence", async (epoch) => {
      const f = await networkFixture("serving", true, epoch, true);
      const directory = await mkdtemp(`${tmpdir()}/delivery-probe-`);
      try {
        const { client, subject } = await f.connect();
        await networkSearch(client);
        // Only credentials minted by this disposable fixture are written.
        await writeFile(`${directory}/human.header`, `Authorization: Bearer ${subject}\n`, { mode: 0o600 });
        await writeFile(`${directory}/api.header`, `Authorization: ${f.requests[0]!.bearer}\n`, { mode: 0o600 });
        await writeFile(`${directory}/curl`, `#!/bin/bash
set -euo pipefail
args=()
for arg; do
  case "$arg" in
    https://preprod.immo.sent-tech.ca/mcp*) arg="\${PROBE_MCP_URL}\${arg#https://preprod.immo.sent-tech.ca}" ;;
    https://preprod.immo.sent-tech.ca/api/*) arg="\${PROBE_API_URL}\${arg#https://preprod.immo.sent-tech.ca}" ;;
  esac
  args+=("$arg")
done
exec /usr/bin/curl "\${args[@]}"
`, { mode: 0o700 });
        let sequence = 0;
        const run = async (overrides: NodeJS.ProcessEnv = {}) => {
          const evidence = `${directory}/evidence-${sequence++}`;
          const invocation = execute("bash", [probe], { env: { ...process.env,
            PATH: `${directory}:${process.env.PATH}`, PROBE_API_URL: f.apiUrl, PROBE_MCP_URL: f.mcpUrl,
            OP_AUTH_HEADER_FILE: `${directory}/human.header`, OP_API_AUTH_HEADER_FILE: `${directory}/api.header`,
            OP_EVIDENCE_DIR: evidence, OP_CITY: "synthetic-city", OP_WORKSPACE: f.data.workspaceId,
            OP_EXPECTED_SIGNAL: f.signal.node.id, OP_EXPECTED_ERROR: "", ...overrides,
          } });
          try { return { ...await invocation, evidence }; }
          finally {
            if (process.env.DELIVERY_PROBE_EVIDENCE_DIR) {
              const saved = `${process.env.DELIVERY_PROBE_EVIDENCE_DIR}/${epoch}-${sequence}`;
              await mkdir(saved, { recursive: true });
              for (const file of ["request.json", "search.json", "api-search.json", "no-token.json", "api-no-token.json", "initialize.json"]) {
                try { await copyFile(`${evidence}/${file}`, `${saved}/${file}`); }
                catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
              }
            }
          }
        };
        const success = await run();
        expect(success.stdout).toContain("PASS:");
        const request = JSON.parse(await readFile(`${success.evidence}/request.json`, "utf8"));
        expect(request.params.arguments).toEqual({ city: "synthetic-city" });
        const response = JSON.parse(await readFile(`${success.evidence}/search.json`, "utf8"));
        expect(JSON.parse(response.result.content[0].text)).toEqual({ city: "synthetic-city", count: 1,
          signals: [expect.objectContaining({ id: f.signal.node.id })] });
        const boundary = JSON.parse(await readFile(`${success.evidence}/api-search.json`, "utf8"));
        expect(boundary.workspaceId).toBe(f.data.workspaceId);
        await expect(run({ OP_WORKSPACE: f.data.otherId })).rejects.toThrow();
        await expect(run({ OP_EXPECTED_SIGNAL: "absent-signal" })).rejects.toThrow();
        await expect(run({ OP_EXPECTED_ERROR: "composition_account" })).rejects.toThrow();
        if (epoch === "scoped") {
          await f.data.pool.query("UPDATE account_users SET status='suspended' WHERE id=$1", [f.data.contributor.id]);
          expect((await run({ OP_EXPECTED_ERROR: "composition_account" })).stdout).toContain("PASS:");
          await expect(run()).rejects.toThrow();
          await f.data.pool.query("UPDATE account_users SET status='approved' WHERE id=$1", [f.data.contributor.id]);
          await f.data.pool.query("UPDATE workspace_memberships SET status='revoked', revoked_at=now() WHERE account_id=$1", [f.data.contributor.id]);
          expect((await run({ OP_EXPECTED_ERROR: "workspace_missing" })).stdout).toContain("PASS:");
          await expect(run({ OP_EXPECTED_ERROR: "composition_account" })).rejects.toThrow();
          await f.data.pool.query("UPDATE workspace_memberships SET status='active', revoked_at=NULL WHERE account_id=$1 AND workspace_id=$2",
            [f.data.contributor.id, f.data.workspaceId]);
          expect((await run()).stdout).toContain("PASS:");
        }
        expect(f.requests.every((r) => r.path === "/api/v1/mcp/facets/signals/search")).toBe(true);
      } finally {
        await f.close();
        await rm(directory, { recursive: true, force: true });
      }
    });
});
