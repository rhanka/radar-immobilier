import { describe, expect, it, vi } from "vitest";
import type { ArtifactsApp } from "@sentropic/artifacts/mcp-core";
import type { VerifiedMcpRequest } from "@sentropic/cluster-mesh/compose/mcp-stateful";
import { ARTIFACT_P0B, ARTIFACT_PART1, ARTIFACT_STRICT } from "@radar/artifacts-host";
import {
  bindArtifactProvider,
  getSourceGuideReference,
  IMMO_ARTIFACT_PROFILE as profile,
  projectSourceBody,
  projectSourceFile,
  withAuthoringGuide,
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

const toBase64 = (bytes: readonly number[]): string => Buffer.from(bytes).toString("base64");

function sourceBody() {
  return {
    artifactId: ARTIFACT_ID,
    releaseId: RELEASE_ID,
    manifest: JSON.stringify({ artifactId: ARTIFACT_ID, digest: "manifest-digest" }),
    files: [
      { path: "index.html", mimeType: "text/html", text: INDEX_HTML, encoding: "utf8", digest: "index-digest", size: toBytes(INDEX_HTML).length },
      { path: "app.css", mimeType: "text/css", text: APP_CSS, encoding: "utf8", digest: "css-digest", size: toBytes(APP_CSS).length },
      { path: "app.js", mimeType: "text/javascript", text: APP_JS, encoding: "utf8", digest: "js-digest", size: toBytes(APP_JS).length },
      { path: "data.json", mimeType: "application/json", text: DATA_JSON, encoding: "utf8", digest: "json-digest", size: toBytes(DATA_JSON).length },
      { path: "blob.bin", mimeType: "application/octet-stream", base64: toBase64([0, 159, 255]), encoding: "base64", digest: "bin-digest", size: 3 },
      { path: "broken.html", mimeType: "text/html", base64: toBase64([255, 254, 0]), encoding: "base64", digest: "broken-digest", size: 3 },
      { path: "unknown", mimeType: "application/octet-stream", base64: toBase64(toBytes("no mime, stays opaque")), encoding: "base64", digest: "unknown-digest", size: toBytes("no mime, stays opaque").length },
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
  it("should project 0.2.9 text/base64 files to publish-compatible text/bytes without encoding", () => {
    const projected = sourceBody().files.map(projectSourceFile) as Record<string, unknown>[];
    expect(projected[0]).toEqual({ path: "index.html", mimeType: "text/html", text: INDEX_HTML, digest: "index-digest", size: toBytes(INDEX_HTML).length });
    expect(projected[0]).not.toHaveProperty("encoding");
    expect(projected[0]).not.toHaveProperty("base64");
    expect(projected[1]).toMatchObject({ path: "app.css", mimeType: "text/css", text: APP_CSS, digest: "css-digest" });
    expect(projected[1]).not.toHaveProperty("encoding");
    expect(projected[2]).toMatchObject({ path: "app.js", text: APP_JS });
    expect(projected[2]).not.toHaveProperty("encoding");
    expect(projected[3]).toMatchObject({ path: "data.json", text: DATA_JSON });
    expect(projected[3]).not.toHaveProperty("encoding");
    expect(projected[4]).toMatchObject({ path: "blob.bin", bytes: [0, 159, 255], digest: "bin-digest", size: 3 });
    expect(projected[4]).not.toHaveProperty("text");
    expect(projected[4]).not.toHaveProperty("encoding");
    expect(projected[4]).not.toHaveProperty("base64");
    expect(projected[5]).toMatchObject({ path: "broken.html", bytes: [255, 254, 0], digest: "broken-digest" });
    expect(projected[5]).not.toHaveProperty("text");
    expect(projected[5]).not.toHaveProperty("encoding");
    expect(projected[6]).toMatchObject({ path: "unknown", digest: "unknown-digest" });
    expect(projected[6]).toHaveProperty("bytes");
    expect(projected[6]).not.toHaveProperty("text");
    expect(projected[6]).not.toHaveProperty("encoding");
  });

  it("should keep a leading UTF-8 BOM on the legacy bytes path so re-encoding is byte-identical", () => {
    const bytes = [0xef, 0xbb, 0xbf, ...toBytes("<p>bom</p>")];
    const projected = projectSourceFile({
      path: "bom.html", mimeType: "text/html", bytes, digest: "bom-digest", sizeBytes: bytes.length,
    }) as Record<string, unknown>;
    expect(typeof projected.text).toBe("string");
    expect((projected.text as string).charCodeAt(0)).toBe(0xfeff);
    expect(toBytes(projected.text as string)).toEqual(bytes);
    expect(Buffer.byteLength(projected.text as string, "utf8")).toBe(projected.sizeBytes);
    expect(projected).toMatchObject({ digest: "bom-digest" });
    expect(projected).not.toHaveProperty("bytes");
  });

  it("should preserve upstream-stripped BOM text without encoding (0.2.9 explicit BOM handling)", () => {
    const originalBytes = [0xef, 0xbb, 0xbf, ...toBytes("<p>bom</p>")];
    const stripped = "<p>bom</p>";
    const projected = projectSourceFile({
      path: "bom.html", mimeType: "text/html", text: stripped, encoding: "utf8",
      digest: "bom-digest", size: originalBytes.length,
    }) as Record<string, unknown>;
    expect(projected).toMatchObject({ path: "bom.html", text: stripped, digest: "bom-digest", size: originalBytes.length });
    expect(projected).not.toHaveProperty("encoding");
    expect(projected).not.toHaveProperty("bytes");
    expect(projected).not.toHaveProperty("base64");
    expect((projected.text as string).charCodeAt(0)).not.toBe(0xfeff);
  });

  it("should keep CESU-8 surrogates and truncated multibyte sequences as bytes", () => {
    for (const bytes of [[0xed, 0xa0, 0x80], [0xe2, 0x82]]) {
      const projected = projectSourceFile({
        path: "broken.html", mimeType: "text/html", bytes,
      }) as Record<string, unknown>;
      expect(projected).toMatchObject({ path: "broken.html", bytes });
      expect(projected).not.toHaveProperty("text");
    }
  });

  it("should decode text MIME types carrying a charset parameter", () => {
    const projected = projectSourceFile({
      path: "index.html", mimeType: "text/html; charset=utf-8", bytes: toBytes(INDEX_HTML),
    }) as Record<string, unknown>;
    expect(projected).toEqual({ path: "index.html", mimeType: "text/html; charset=utf-8", text: INDEX_HTML });
  });

  it("should keep byte arrays with out-of-range or non-integer values opaque", () => {
    for (const bytes of [[-1], [256], [1.5]]) {
      const file = { path: "odd.html", mimeType: "text/html", bytes };
      expect(projectSourceFile(file)).toBe(file);
    }
  });

  it("should preserve digest and size fields so integrity can still be checked", () => {
    const projected = projectSourceFile({
      path: "app.css", mimeType: "text/css", bytes: toBytes(APP_CSS), digest: "css-digest", sizeBytes: 41,
    }) as Record<string, unknown>;
    expect(projected).toMatchObject({ digest: "css-digest", sizeBytes: 41, text: APP_CSS });
    expect(projected).not.toHaveProperty("bytes");
  });

  it("should project v1 root files and the v2 output envelope alike", () => {
    const file = { path: "index.html", mimeType: "text/html", text: INDEX_HTML, encoding: "utf8", digest: "d", size: 1 };
    expect(projectSourceBody({ artifactId: ARTIFACT_ID, files: [file] })).toMatchObject({
      files: [{ path: "index.html", text: INDEX_HTML }] });
    expect(projectSourceBody({ ok: true, output: { artifactId: ARTIFACT_ID, files: [file] } })).toMatchObject({
      output: { files: [{ path: "index.html", text: INDEX_HTML }] } });
    const projected = projectSourceBody({ artifactId: ARTIFACT_ID, files: [file] }) as { files: Record<string, unknown>[] };
    expect(projected.files[0]).not.toHaveProperty("encoding");
    expect(projectSourceBody(null)).toBeNull();
    expect(projectSourceBody({ artifactId: ARTIFACT_ID })).toEqual({ artifactId: ARTIFACT_ID });
  });

  it("should round-trip get_source text back through publish within a small size budget", async () => {
    const original = sourceBody();
    const decodedBytes = (file: Record<string, unknown>): number[] =>
      typeof file.text === "string" ? Array.from(new TextEncoder().encode(file.text as string))
      : typeof file.base64 === "string" ? Array.from(Buffer.from(file.base64 as string, "base64"))
      : [];
    const rawBytes = original.files.reduce((sum, file) => sum + decodedBytes(file as Record<string, unknown>).length, 0);
    const originalBytes = new Map(original.files.map((file) => [file.path, decodedBytes(file as Record<string, unknown>)]));
    const { binding } = setup(original);
    const result = await binding.invoke("artifacts_get_source", { artifactId: ARTIFACT_ID }, authority);
    expect(result.isError).not.toBe(true);
    const payload = read(result);
    const data = (payload.output ?? payload) as Record<string, unknown>;
    for (const file of data.files as Record<string, unknown>[]) {
      if (["index.html", "app.css", "app.js", "data.json"].includes(String(file.path))) {
        expect(file).toHaveProperty("text");
        expect(file).not.toHaveProperty("bytes");
        expect(file).not.toHaveProperty("encoding");
        expect(file).not.toHaveProperty("base64");
        expect(toBytes(file.text as string)).toEqual(originalBytes.get(String(file.path)));
      }
      if (["blob.bin", "broken.html"].includes(String(file.path))) {
        expect(file).toHaveProperty("bytes");
        expect(file).not.toHaveProperty("text");
        expect(file).not.toHaveProperty("encoding");
        expect(file).not.toHaveProperty("base64");
      }
    }
    const guide = (data.authoringGuide ?? payload.authoringGuide) as Record<string, unknown>;
    expect(guide.guideId).toBe(AUTHORING_GUIDE_ID);
    expect(guide.revision).toBe(AUTHORING_GUIDE_REVISION);
    expect(guide).not.toHaveProperty("starter");
    const size = JSON.stringify(payload).length;
    expect(size).toBeLessThan(4 * rawBytes + 8192);
    const editable = (data.files as Record<string, unknown>[])
      .filter((file) => typeof file.text === "string")
      .map((file) => ({ path: file.path, mimeType: file.mimeType, text: file.text }));
    const publisher = setup({ releaseId: RELEASE_ID });
    const published = await publisher.binding.invoke("artifacts_publish",
      { artifactId: ARTIFACT_ID, files: editable, idempotencyKey: "round-trip",
        ...(ARTIFACT_STRICT ? { expectedCurrentReleaseId: null } : {}) }, authority);
    expect(published.isError).not.toBe(true);
    expect(read(published)).toMatchObject({ releaseId: RELEASE_ID });
    expect(publisher.execute).toHaveBeenCalledTimes(1);
    const forwarded = publisher.execute.mock.calls[0]?.[0] as {
      body?: { files?: { path: string; bytes: number[] }[] };
    };
    const forwardedBytes = new Map(
      (forwarded?.body?.files ?? []).map((file) => [file.path, file.bytes]));
    for (const file of editable) {
      expect(forwardedBytes.get(file.path as string)).toEqual(toBytes(file.text as string));
      expect(forwardedBytes.get(file.path as string)).toEqual(originalBytes.get(file.path as string));
    }
  });

  it("should project source files and attach the guide reference under the v2 envelope", () => {
    const file = { path: "bom.html", mimeType: "text/html", text: "<p>bom</p>", encoding: "utf8", digest: "bom-digest", size: 12 };
    const projected = projectSourceBody({ ok: true, output: { artifactId: ARTIFACT_ID, files: [file] } });
    expect(projected).toMatchObject({ output: { files: [{ path: "bom.html", text: "<p>bom</p>" }] } });
    const out = (projected as { output: { files: Record<string, unknown>[] } }).output;
    expect(out.files[0]).not.toHaveProperty("encoding");
    expect((out.files[0]!.text as string).charCodeAt(0)).not.toBe(0xfeff);
    const guided = withAuthoringGuide("artifacts_get_source", projected) as Record<string, { authoringGuide?: unknown }>;
    const holder = (ARTIFACT_PART1 ? guided.output : guided) as Record<string, Record<string, unknown>>;
    expect(holder.authoringGuide?.guideId).toBe(AUTHORING_GUIDE_ID);
    expect(holder.authoringGuide?.revision).toBe(AUTHORING_GUIDE_REVISION);
    expect(holder.authoringGuide).not.toHaveProperty("starter");
  });

  it("should keep the get_source guide reference small next to the full guide", () => {
    const reference = JSON.stringify(getSourceGuideReference()).length;
    const full = JSON.stringify(getAuthoringGuide()).length;
    expect(full).toBeGreaterThan(32 * 1024);
    expect(reference).toBeLessThan(8192);
    expect(reference).toBeLessThan(full / 4);
  });
});
