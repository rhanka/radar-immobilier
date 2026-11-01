import { readFileSync } from "node:fs";
import { parse } from "pg-connection-string";
import pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { createAccountBinding } from "./account-binding.js";
import { bindDatabaseName } from "./database-url.js";

describe("bindDatabaseName", () => {
  const roleUrl = "postgresql://immo_mcp_artifact_writer:p%40ss@radar-postgres:5432/radar?sslmode=disable";

  it("rebinds the role URL to the database selected by the cutover", () => {
    const bound = new URL(bindDatabaseName(roleUrl, "radar_next"));
    expect(bound.pathname).toBe("/radar_next");
    expect(bound.username).toBe("immo_mcp_artifact_writer");
    expect(bound.password).toBe("p%40ss");
    expect(bound.host).toBe("radar-postgres:5432");
    expect(bound.search).toBe("?sslmode=disable");
  });

  it.each(["Radar-Next", "radar next", "db$1", "été", "a;b@c:d&e=f+g,h", "100%", "x".repeat(63), "é".repeat(31)])(
    "accepts the valid PostgreSQL name %j and pg reads it back verbatim", (name) => {
      expect(parse(bindDatabaseName(roleUrl, name)).database).toBe(name);
    });

  it("keeps the URL unchanged without a selected database", () => {
    expect(bindDatabaseName(roleUrl, undefined)).toBe(roleUrl);
    expect(bindDatabaseName(roleUrl, "")).toBe(roleUrl);
  });

  it("refuses names over 63 bytes or containing / ? #, and non-PostgreSQL URLs", () => {
    for (const name of ["x".repeat(64), "é".repeat(32), "a/b", "a?b", "a#b"]) {
      expect(() => bindDatabaseName(roleUrl, name)).toThrow("database_name_invalid");
    }
    expect(() => bindDatabaseName("https://example.test/radar", "radar")).toThrow("database_url_invalid");
  });
});

describe("optional POSTGRES_DB binding", () => {
  const roleUrl = "postgresql://immo_mcp_account_reader:secret@radar-postgres:5432/radar";
  it("declares the Secret key optional so a missing key keeps the URL database", () => {
    const manifest = readFileSync(new URL("../../../deploy/k8s/immo-mcp/40-immo-mcp-http-deploy.yaml", import.meta.url), "utf8");
    expect(manifest).toContain("            - name: IMMO_MCP_DATABASE_NAME\n" +
      "              valueFrom: { secretKeyRef: { name: radar-db-credentials, key: POSTGRES_DB, optional: true } }\n");
    expect(parse(bindDatabaseName(roleUrl, undefined)).database).toBe("radar");
  });

  it("keeps the role URL database when IMMO_MCP_DATABASE_NAME is absent and follows it when set", async () => {
    const seen: (string | undefined)[] = [];
    const Real = pg.Pool;
    const spy = vi.spyOn(pg, "Pool").mockImplementation(class extends Real {
      constructor(config?: pg.PoolConfig) { seen.push(config?.connectionString); super(config); }
    } as never);
    try {
      for (const env of [{ IMMO_MCP_ACCOUNT_DATABASE_URL: roleUrl },
        { IMMO_MCP_ACCOUNT_DATABASE_URL: roleUrl, IMMO_MCP_DATABASE_NAME: "radar_next" }]) {
        await createAccountBinding(env)!.close();
      }
    } finally { spy.mockRestore(); }
    expect(seen.map((url) => parse(url!).database)).toEqual(["radar", "radar_next"]);
    expect(seen[0]).toBe(roleUrl);
  });
});
