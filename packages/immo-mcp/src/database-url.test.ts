import { describe, expect, it } from "vitest";
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

  it("keeps the URL unchanged without a selected database", () => {
    expect(bindDatabaseName(roleUrl, undefined)).toBe(roleUrl);
    expect(bindDatabaseName(roleUrl, "  ")).toBe(roleUrl);
  });

  it("refuses an invalid database name or a non-PostgreSQL URL", () => {
    expect(() => bindDatabaseName(roleUrl, "radar/../x")).toThrow("database_name_invalid");
    expect(() => bindDatabaseName("https://example.test/radar", "radar")).toThrow("database_url_invalid");
  });
});
