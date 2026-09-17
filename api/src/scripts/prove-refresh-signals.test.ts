import { describe, expect, it } from "vitest";
import { access, readFile, unlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { markdown, proveRefreshSignals, type ExportedGraphNode } from "./prove-refresh-signals.js";

const fixturePath = fileURLToPath(new URL("./fixtures/prove-refresh-signals.ndjson", import.meta.url));
const requestPath = fileURLToPath(new URL("./fixtures/.prove-refresh-signals-request.json", import.meta.url));

async function render(input: string, ids: string, origin: string): Promise<string> {
  const fixture = await readFile(input, "utf8");
  const nodes = fixture.trim().split("\n").map((line) => JSON.parse(line) as ExportedGraphNode);
  return markdown(proveRefreshSignals(nodes, ids.split(","), origin));
}

describe("proveRefreshSignals", () => {
  it("renders a hermetic B-prime proof from a graph export", async () => {
    const report = await render(fixturePath, "proof-qualified,proof-excluded", "https://immo-preprod.sent-tech.ca");
    expect(report).toContain("| proof-qualified | salaberry-de-valleyfield | Signal | B′ qualifié | https://immo-preprod.sent-tech.ca/geo/city/salaberry-de-valleyfield?mode=signal&filter.subset=b |");
    expect(report).toContain("exclu (non_residentiel_franc)");
  });

  it("renders operator-supplied cycle ids when requested", async () => {
    try {
      await access(requestPath);
    } catch {
      return;
    }
    const request = JSON.parse(await readFile(requestPath, "utf8")) as { input: string; ids: string; origin: string; output: string };
    const report = await render(request.input, request.ids, request.origin);
    if (request.output) await writeFile(request.output, report);
    process.stdout.write(report);
    await unlink(requestPath);
  });
});
