import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type ToolResult = { content: { type: string; text?: string }[]; isError?: boolean };
type Capture = {
  calls: Record<string, { args: Record<string, unknown>; result: ToolResult }>;
  limitedScope: { calls: Record<string, ToolResult> };
  missingCoarseScope: { code: number };
};
const fixtureBytes = readFileSync(new URL("./fixtures/immo-tools.v1.json", import.meta.url));
const fixture = JSON.parse(fixtureBytes.toString("utf8")) as {
  serverVersion: { name: string; version: string };
  serverCapabilities: unknown;
  tools: unknown[];
  captures: { http: Capture; simulation: Capture };
};
const receipt = JSON.parse(readFileSync(
  new URL("./fixtures/immo-deployed-baseline.v1.json", import.meta.url), "utf8",
)) as {
  toolFixtureSha256: string;
  toolCount: number;
  versions: Record<string, string>;
};
describe("deployed twelve-tool baseline", () => {
  it("anchors the tool fixture to the captured image and build receipt", () => {
    expect(receipt).toMatchObject({
      schemaVersion: 1,
      image: "ghcr.io/rhanka/radar-api@sha256:96a0f646b1316bce58231252cf45a766b31c46fdd7fb49ab359ada8834d3f221",
      buildCommit: "4dc37c8bc6d067af1c8c7a5a3643e113cf7e86e1",
      production: {
        image: "ghcr.io/rhanka/radar-api@sha256:73dc465bbe579932fcb644ee9e2538d6bb716542776d912dc7cbc19c25792f10",
        buildCommit: "ea90951ca253bd300c26daa44ce0ce416602a271",
      },
      toolFixture: "immo-tools.v1.json",
      toolFixtureSha256: "31487e8fb9b85019fc707ed3a7296e33156c46fb5fd3071d456d6dae1b44d998",
      toolCount: 12,
      versions: { "@sentropic/mcp-auth": "0.1.0" },
    });
    expect(createHash("sha256").update(fixtureBytes).digest("hex")).toBe(receipt.toolFixtureSha256);
    expect(fixture.tools).toHaveLength(receipt.toolCount);
    expect(fixture.serverVersion.version).toBe(receipt.versions["@radar/immo-mcp"]);
  });

});

