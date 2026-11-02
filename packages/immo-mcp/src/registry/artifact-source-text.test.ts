import { describe, expect, it, vi } from "vitest";
import type { ArtifactsApp } from "@sentropic/artifacts/mcp-core";
import type { VerifiedMcpRequest } from "@sentropic/cluster-mesh/compose/mcp-stateful";
import { ARTIFACT_P0B } from "@radar/artifacts-host";
import {
  bindArtifactProvider,
  getSourceGuideReference,
  IMMO_ARTIFACT_PROFILE as profile,
  projectSourceBody,
  projectSourceFile,
} from "./artifact-provider.js";
import {
  AUTHORING_GUIDE_ID,
  AUTHORING_GUIDE_REVISION,
  getAuthoringGuide,
} from "./artifact-authoring-guide.js";

const ARTIFACT_ID = "123e4567-e89b-12d3-a456-426614174000";
const RELEASE_ID = "123e4567-e89b-12d3-a456-426614174001";

const authority: VerifiedMcpRequest = {
  principal: { issuer: "synthetic", sub: "alice", scopes: ["immo:artifacts:read", "immo:artifacts:write"],
    claims: [], attributes: {} },
  resource: "synthetic:mcp", correlationId: "source-text", signal: new AbortController().signal,
};

const toBytes = (text: string): number[] => Array.from(new TextEncoder().encode(text));

// Small page mirroring the preprod defect report (~816 bytes of HTML).
const INDEX_HTML = `<!doctype html>
<html lang="fr" data-st-theme="sent-tech">
<head><meta charset="utf-8"><title>Logement Sherbrooke</title><link rel="stylesheet" href="/app.css"></head>
<body><main class="st-card"><h1>6 logements admissibles</h1><p class="st-tag st-tag--sm st-tag--info">Zonage H3</p><p>Parcelle 123, rue King Ouest. PPCMOI en cours, CPTAQ hors zone.</p><button class="st-button st-button--primary st-button--md" type="button">Voir le dossier</button></main><script src="/app.js"></script></body>
</html>
`;
const APP_CSS = ":root{color-scheme:light}\nbody{margin:0}\n";
const APP_JS = "document.querySelector('button')?.addEventListener('click',()=>history.replaceState({},'',location.pathname));\n";
const DATA_JSON = '{"zone":"H3","units":6}';

function sourceBody() {
  return {
    artifactId: ARTIFACT_ID,
    releaseId: RELEASE_ID,
    manifest: JSON.stringify({ artifactId: ARTIFACT_ID, digest: "manifest-digest" }),
    files: [
      { path: "index.html", mimeType: "text/html", bytes: toBytes(INDEX_HTML) },
      { path: "app.css", mimeType: "text/css", bytes: toBytes(APP_CSS), digest: "css-digest", sizeBytes: toBytes(APP_CSS).length },
      { path: "app.js", mimeType: "text/javascript", bytes: toBytes(APP_JS) },
      { path: "data.json", mimeType: "application/json", bytes: toBytes(DATA_JSON) },
      { path: "blob.bin", mimeType: "application/octet-stream", bytes: [0, 159, 255] },
      { path: "broken.html", mimeType: "text/html", bytes: [255, 254, 0] },
      { path: "unknown", bytes: toBytes("no mime, stays opaque") },
    ],
  };
}

function setup(body: unknown) {
  const execute = vi.fn<ArtifactsApp["execute"]>(async (_request, invocation) => ({
    ok: true as const, result: { status: 200, body },
    invocationId: invocation.invocationId, commitState: "committed" as const, replayed: false }));
  const binding = bindArtifactProvider({ app: { execute, profileDigest: profile.profileDigest,
    selectedCapabilities: profile.selectedCapabilities }, storageScopeId: "synthetic",
    authorizeCommit: () => (async () => ({ allowed: true as const })) as never });
  return { binding, execute };
}

const read = (result: { content: unknown[] }) => JSON.parse((result.content[0] as { text: string }).text);

describe.skipIf(!ARTIFACT_P0B)("artifact source text projection", () => {
  it("should decode text MIME files to text and keep binary or undecodable payloads as bytes", () => {
    const projected = sourceBody().files.map(projectSourceFile) as Record<string, unknown>[];
    expect(projected[0]).toEqual({ path: "index.html", mimeType: "text/html", text: INDEX_HTML });
    expect(projected[1]).toMatchObject({ path: "app.css", mimeType: "text/css", text: APP_CSS });
    expect(projected[2]).toMatchObject({ path: "app.js", text: APP_JS });
    expect(projected[3]).toMatchObject({ path: "data.json", text: DATA_JSON });
    expect(projected[4]).toMatchObject({ path: "blob.bin", bytes: [0, 159, 255] });
    expect(projected[4]).not.toHaveProperty("text");
    expect(projected[5]).toMatchObject({ path: "broken.html", bytes: [255, 254, 0] });
    expect(projected[5]).not.toHaveProperty("text");
    expect(projected[6]).toMatchObject({ path: "unknown" });
    expect(projected[6]).not.toHaveProperty("text");
  });

  it("should preserve digest and size fields so integrity can still be checked", () => {
    const projected = projectSourceFile({
      path: "app.css", mimeType: "text/css", bytes: toBytes(APP_CSS), digest: "css-digest", sizeBytes: 41,
    }) as Record<string, unknown>;
    expect(projected).toMatchObject({ digest: "css-digest", sizeBytes: 41, text: APP_CSS });
    expect(projected).not.toHaveProperty("bytes");
  });

  it("should project v1 root files and the v2 output envelope alike", () => {
    const file = { path: "index.html", mimeType: "text/html", bytes: toBytes(INDEX_HTML) };
    expect(projectSourceBody({ artifactId: ARTIFACT_ID, files: [file] })).toMatchObject({
      files: [{ path: "index.html", text: INDEX_HTML }] });
    expect(projectSourceBody({ ok: true, output: { artifactId: ARTIFACT_ID, files: [file] } })).toMatchObject({
      output: { files: [{ path: "index.html", text: INDEX_HTML }] } });
    expect(projectSourceBody(null)).toBeNull();
    expect(projectSourceBody({ artifactId: ARTIFACT_ID })).toEqual({ artifactId: ARTIFACT_ID });
  });

  it("should round-trip get_source text back through publish within a small size budget", async () => {
    const rawBytes = sourceBody().files.reduce((sum, file) => sum + (file.bytes as number[]).length, 0);
    const { binding } = setup(sourceBody());
    const result = await binding.invoke("artifacts_get_source", { artifactId: ARTIFACT_ID }, authority);
    expect(result.isError).not.toBe(true);
    const payload = read(result);
    for (const file of payload.files as Record<string, unknown>[]) {
      if (["index.html", "app.css", "app.js", "data.json"].includes(String(file.path))) {
        expect(file).toHaveProperty("text");
        expect(file).not.toHaveProperty("bytes");
      }
    }
    expect(payload.authoringGuide.guideId).toBe(AUTHORING_GUIDE_ID);
    expect(payload.authoringGuide.revision).toBe(AUTHORING_GUIDE_REVISION);
    expect(payload.authoringGuide).not.toHaveProperty("starter");
    const size = JSON.stringify(payload).length;
    expect(size).toBeLessThan(4 * rawBytes + 8192);
    const editable = (payload.files as Record<string, unknown>[])
      .filter((file) => typeof file.text === "string")
      .map((file) => ({ path: file.path, mimeType: file.mimeType, text: file.text }));
    const publisher = setup({ releaseId: RELEASE_ID });
    const published = await publisher.binding.invoke("artifacts_publish",
      { artifactId: ARTIFACT_ID, files: editable, idempotencyKey: "round-trip" }, authority);
    expect(published.isError).not.toBe(true);
    expect(read(published)).toMatchObject({ releaseId: RELEASE_ID });
    expect(publisher.execute).toHaveBeenCalledTimes(1);
  });

  it("should keep the get_source guide reference small next to the full guide", () => {
    const reference = JSON.stringify(getSourceGuideReference()).length;
    const full = JSON.stringify(getAuthoringGuide()).length;
    expect(full).toBeGreaterThan(32 * 1024);
    expect(reference).toBeLessThan(8192);
    expect(reference).toBeLessThan(full / 4);
  });
});
