import { describe, expect, it, vi } from "vitest";
import { createSignalBinding } from "./signal-store.js";

describe("signal binding activation", () => {
  it("stays off without the flag", () => {
    expect(createSignalBinding({})).toBeUndefined();
    expect(createSignalBinding({ IMMO_MCP_SIGNALS_WRITE_ENABLED: "0",
      IMMO_MCP_SIGNAL_DATABASE_URL: "postgres://u:p@127.0.0.1:1/db" })).toBeUndefined();
  });

  it("starts read-only with an explicit log when the flag is on but the Secret is absent", () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      expect(createSignalBinding({ IMMO_MCP_SIGNALS_WRITE_ENABLED: "1" })).toBeUndefined();
      expect(String(stderr.mock.calls[0]?.[0])).toContain("signal binding unavailable");
      expect(String(stderr.mock.calls[0]?.[0])).toContain("read-only");
    } finally { stderr.mockRestore(); }
  });

  it("builds a pool when the flag and the database URL are both present", async () => {
    const pool = createSignalBinding({ IMMO_MCP_SIGNALS_WRITE_ENABLED: "1",
      IMMO_MCP_SIGNAL_DATABASE_URL: "postgres://u:p@127.0.0.1:1/db" });
    expect(pool).toBeDefined();
    await pool?.end();
  });
});
