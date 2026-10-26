import { describe, expect, it } from "vitest";
import { servedBodyLeaksCredentials } from "./content-isolation.js";
import { READER_EXAMPLE_HTML } from "./reader-example.js";

describe("minimal connected example", () => {
  it("should call only named operations and expose no credentials", () => {
    expect(READER_EXAMPLE_HTML).toContain("/__reader/api/geo.read.v1");
    expect(READER_EXAMPLE_HTML).toContain("/__reader/api/signals.protected-read.v1");
    expect(READER_EXAMPLE_HTML).not.toContain("radar_session");
    expect(servedBodyLeaksCredentials(READER_EXAMPLE_HTML)).toBe(false);
  });

  it("should remove the grant from the URL before rendering", () => {
    expect(READER_EXAMPLE_HTML).toContain("history.replaceState");
  });
});
