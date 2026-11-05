import { describe, expect, it, vi } from "vitest";
import { ARTIFACT_P0B, ARTIFACT_STRICT, DESIGN_KIT_ASSETS, designKitAssetUrl } from "@radar/artifacts-host";
import { releaseCspForHtml } from "../../../../api/src/artifacts/release-files.js";
import type { ArtifactsApp } from "@sentropic/artifacts/mcp-core";
import type { VerifiedMcpRequest } from "@sentropic/cluster-mesh/compose/mcp-stateful";
import {
  AUTHORING_GUIDE_ID,
  AUTHORING_GUIDE_REVISION,
  AUTHORING_GUIDE_SNIPPET,
  STARTER_VERSION,
  getAuthoringGuide,
} from "./artifact-authoring-guide.js";
import {
  bindArtifactProvider,
  IMMO_ARTIFACT_MANIFEST,
  IMMO_ARTIFACT_PROFILE as profile,
  withAuthoringGuide,
} from "./artifact-provider.js";
import { FRAMEWORK_STARTERS } from "./framework-starters.js";

const authority: VerifiedMcpRequest = {
  principal: { issuer: "synthetic", sub: "alice", scopes: ["immo:artifacts:read", "immo:artifacts:write"],
    claims: [], attributes: {} },
  resource: "synthetic:mcp", correlationId: "test", signal: new AbortController().signal,
};

function setup(body: unknown) {
  const execute = vi.fn<ArtifactsApp["execute"]>(async (_request, invocation) => ({
    ok: true as const, result: { status: 200, body },
    invocationId: invocation.invocationId, commitState: "committed" as const, replayed: false,
  }));
  const app = { execute, profileDigest: profile.profileDigest, selectedCapabilities: profile.selectedCapabilities };
  const binding = bindArtifactProvider({ app, storageScopeId: "synthetic",
    authorizeCommit: () => (async () => ({ allowed: true as const })) as never });
  return { binding, execute };
}

const read = (result: { content: unknown[] }) => JSON.parse((result.content[0] as { text: string }).text);

describe("artifact authoring guide", () => {
  it("should document the display label, publication timestamps and newest-first discovery", () => {
    const discovery = getAuthoringGuide().artifactDiscovery;
    expect(discovery.displayLabel).toBe("Use bindingName as the display label until part1 title/description metadata is available.");
    expect(discovery.listOrder).toContain("updatedAt descending, nulls last, then createdAt descending");
    expect(discovery.timestamps).toContain("current release publication time, or null if never published");
    expect(discovery.links).toContain("pinnedUrl");
    expect(discovery.state).toContain("published");
  });

  it("should expose one versioned definition with starter, H5 bridge and checklist", () => {
    const guide = getAuthoringGuide();
    expect(guide.guideId).toBe(AUTHORING_GUIDE_ID);
    expect(guide.revision).toBe(AUTHORING_GUIDE_REVISION);
    expect(guide.starterVersion).toBe(STARTER_VERSION);
    expect(guide.starterVersion).toBe("1.1.0");
    expect(guide.starter.version).toBe(guide.starterVersion);
    expect(guide.theme).toBe("sent-tech");
    expect(guide.rule).toContain("Sentropic DS is mandatory");
    expect(guide.data.warning).toContain("Never call /api/*");
    expect(guide.data.operations.map((op) => op.name)).toEqual(["workspaces.list.v1", "baskets.context.v1", "baskets.search.v1",
      "baskets.state.v1", "geo.read.v1", "geo.cities.v1", "geo.collection-items.v1", "signals.protected-read.v1", "status.closed.v1"]);
    expect(guide.checklist.length).toBeGreaterThan(0);
    expect(guide.frameworks.map((entry) => entry.framework))
      .toEqual(["plain JS", "React", "Svelte", "Vue", "Angular"]);
    expect(guide.uiState.contractId).toBe("immo.page-state.v1");
    expect(guide.frameworkBuild).toContain("ImmoArtifact.mount/dispose");
    expect(guide.components.length).toBeGreaterThan(0);
    for (const component of guide.components) {
      expect(component.sourcePackage).toBe("@sentropic/design-system-react");
      expect(component.promptHash).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(Object.isFrozen(guide)).toBe(true);
  });

  it("should publish the same-origin tile template and both basemap attributions", () => {
    const mapBase = getAuthoringGuide().mapBase;
    expect(mapBase.tiles).toBe("/__artifacts/tiles/v1/{z}/{x}/{y}");
    expect(mapBase.labels).toBe("/__artifacts/tiles/v1/labels/{z}/{x}/{y}");
    expect(mapBase.note).toContain("img-src 'self'");
    expect(mapBase.attribution.map((entry) => entry.text)).toEqual([
      "© Gouvernement du Québec — Cartes topographiques 1/20 000 (CC-BY 4.0)",
      "© Sa Majesté le Roi du chef du Canada, représenté par le ministre de Ressources naturelles Canada",
    ]);
    for (const entry of mapBase.attribution) {
      expect(entry.licenseUrl).toMatch(/^https:\/\//);
    }
  });

  it("should tell pages how to load the I-4 map base with tiles plus geo ops", () => {
    const mapBase = getAuthoringGuide().mapBase;
    const howTo = mapBase.howTo.join("\n");
    for (const fragment of ["createMap", "basemapTemplate", "/__artifacts/tiles/v1/{z}/{x}/{y}",
      "geo.cities.v1", "geo.collection-items.v1", "setZones", "setLots", "fitToBounds",
      "setPaint", "worker-src 'none'", "img-src"]) {
      expect(howTo, fragment).toContain(fragment);
    }
    expect(howTo).toContain("PR #996");
    const ops = Object.fromEntries(getAuthoringGuide().data.operations.map((op) => [op.name, op]));
    expect(ops["geo.read.v1"]!.response).toContain("geo.collection-items.v1");
    expect(ops["geo.collection-items.v1"]!.response).toContain("truncated");
    expect(ops["geo.collection-items.v1"]!.response).toContain("geo_governed_not_served");
    expect(ops["geo.cities.v1"]!.path).toBe("/__reader/api/geo.cities.v1");
  });

  it("should require the published audit CLI and block findings and tool errors", () => {
    const checklist = getAuthoringGuide().checklist.join("\n");
    expect(checklist).toContain("npx --yes -p @sentropic/design-system-skills@0.1.0 design audit ./index.html");
    expect(checklist).toContain("exit 1 (findings) and exit 2 (tool error) both block publication");
    expect(checklist).not.toMatch(/skills@0\.3\.2|design check|--fail-under/);
  });

  it("should preserve artifact identity when editing and disclose unavailable lifecycle actions", () => {
    const guide = getAuthoringGuide();
    expect(guide.revision).toBe(AUTHORING_GUIDE_REVISION);
    const editing = guide.lifecycle.editing.join("\n");
    expect(editing).toContain("artifacts_get_source → edit → artifacts_publish");
    expect(editing).toContain("same artifactId");
    expect(editing).toContain("stableUrl stays the same");
    expect(editing).toContain("fresh idempotencyKey for changed content");
    expect(editing).toContain("artifacts_get returns metadata");
    if (ARTIFACT_P0B) {
      expect(editing).not.toContain("source retrieval is blocked");
      expect(editing).toContain("artifacts_get_source returns the retained manifest and file text");
      expect(editing).toContain("artifacts_publish_bundle");
      expect(guide.lifecycle.unavailableTools).toEqual(["artifacts_restore", "artifacts_fork", "artifacts_promote", "artifacts_renew"]);
      expect(guide.lifecycle.deleteRestore).toContain("explicit human confirmation");
      expect(guide.lifecycle.sharing).toContain("named read access");
    } else {
      expect(editing).toContain("source retrieval is blocked");
      expect(guide.lifecycle.unavailableTools).toEqual(["artifacts_get_source", "artifacts_delete",
        "artifacts_restore", "artifacts_set_access", "artifacts_fork", "artifacts_promote", "artifacts_renew"]);
    }
    // The description pointer is identical in every profile: availability
    // detail lives in the guide, never in tool definitions.
    expect(AUTHORING_GUIDE_SNIPPET).toContain("authoringGuide");
    expect(AUTHORING_GUIDE_SNIPPET).toContain("follow it");
    expect(guide.lifecycle.deleteRestore).toContain("unavailable");
    expect(guide.lifecycle.sharing).toContain("unavailable");
    const sharing = guide.lifecycle.sharing;
    expect(sharing).toContain("VIEW ONLY");
    expect(sharing).toContain("Product Owner");
    expect(sharing).toContain("Public sharing");
    expect(sharing).toContain("all retained versions");
    expect(sharing).toContain("resumes automatically");
    if (ARTIFACT_P0B) {
      const share = (guide.artifactLifecycle?.share ?? []).join("\n");
      expect(share).toContain("Share with Farid");
      expect(share).toContain("ONE named colleague");
      expect(share).toContain("never platform-wide, never public");
      expect(share).toContain("permanently disabled");
      expect(share).toContain("artifacts_lookup_people");
      expect(share).toContain("userRef");
      expect(share).toContain("all retained versions");
      expect(share).toContain("artifacts_list_access");
      expect(share).toContain("artifacts_revoke_reader_consent");
      expect(share).toContain("Product Owner");
      expect(share).toContain("Chaperon Immobilier");
      expect(guide.lifecycle.sharing).toContain("memorized until revoked");
      expect(guide.lifecycle.sharing).not.toContain("persistent opening consent");
    }
    expect(guide.data.grantCycle.join("\n")).toContain("basket_consent_required");
    expect(guide.data.grantCycle.join("\n")).toContain("persistent baskets consent");
    expect(guide.data.grantCycle.join("\n")).not.toContain("persistent opening consent");
    expect(guide.data.grantCycle.join("\n")).toContain("records nothing");
    expect(guide.data.errorKinds.map((entry) => entry.kind)).toContain("consent");
  });

  it("should document platform mode as settable and userRef as the only principalId form (R3)", () => {
    const guide = getAuthoringGuide();
    const sharing = guide.lifecycle.sharing;
    expect(sharing).toContain("sentropic:platform");
    expect(sharing).not.toContain("not available through this catalogue");
    const share = (guide.artifactLifecycle?.share ?? []).join("\n");
    expect(share).toContain("principalId:'sentropic:platform'");
    expect(share).toContain("opaque userRef returned by artifacts_lookup_people");
    expect(share).toContain("never an IdP sub");
    expect(share).not.toContain("approved IMMO account IdP sub");
    expect(share).toContain("sentropic:public is refused");
  });

  it("should require the exact byte size in both upload sequences (R4)", () => {
    const guide = getAuthoringGuide();
    const editing = guide.lifecycle.editing.join("\n");
    expect(editing).toContain("artifacts_create_upload({artifactId, mimeType, maxSize:<exact file byte size>})");
    expect(editing).toContain("binds that exact Content-Length");
    const edit = (guide.artifactLifecycle?.edit ?? []).join("\n");
    expect(edit).toContain("artifacts_create_upload({artifactId, mimeType, maxSize:<exact file byte size>})");
    expect(edit).toContain("a PUT of any other size is refused");
  });

  it("should state the get_source bound for large releases (N5)", () => {
    const guide = getAuthoringGuide();
    const edit = (guide.artifactLifecycle?.edit ?? []).join("\n");
    expect(edit).toContain("32 files / 256 KiB");
    expect(edit).toContain("never invent missing source");
  });

  it("should distinguish published framework packages from the CSS snapshot", () => {
    expect(FRAMEWORK_STARTERS.filter((entry) => entry.framework !== "plain JS")
      .map((entry) => [entry.framework, entry.packageVersion])).toEqual([
      ["React", "0.38.0"], ["Svelte", "0.36.0"], ["Vue", "0.38.0"], ["Angular", "0.38.0"],
    ]);
    expect(FRAMEWORK_STARTERS.find((entry) => entry.framework === "React")?.cssSnapshotVersion).toBe("0.36.46");
  });

  it("should describe React CSS recipes without claiming Elements catalogue contracts", () => {
    const guide = getAuthoringGuide();
    const recipes = [...guide.components, ...FRAMEWORK_STARTERS.flatMap((entry) => entry.componentRefs)];
    for (const recipe of recipes) {
      expect(recipe).toMatchObject({ sourcePackage: "@sentropic/design-system-react", snapshotVersion: "0.36.46" });
      expect(recipe.componentName).toBeTruthy();
      for (const key of ["catalogId", "componentId", "contractVersion"]) expect(recipe).not.toHaveProperty(key);
    }
    expect(guide.componentUsage).not.toContain("components[].catalogId");
    expect(guide.elements.componentIds).toEqual(["BarChart", "BpmnCanvas", "DecisionDossier"]);
  });

  it("should document the worker-free map base with pinned kit URLs", () => {
    const guide = getAuthoringGuide();
    expect(guide.mapBase.tiles).toBe("/__artifacts/tiles/v1/{z}/{x}/{y}");
    expect(guide.mapBase.labels).toBe("/__artifacts/tiles/v1/labels/{z}/{x}/{y}");
    expect(guide.mapBase.attribution).toHaveLength(2);
    expect(guide.mapBase.kit).toBe("map");
    expect(guide.mapBase.version).toBe("map-v1");
    expect(guide.mapBase.manifest.map((asset) => asset.file).sort())
      .toEqual(["map-base.css", "map-base.mjs"]);
    for (const asset of guide.mapBase.manifest) {
      expect(asset.url).toContain(asset.sha256Hex);
      expect(asset.url).toContain("/__artifacts/design/map-v1/");
    }
    const all = [...guide.mapBase.load, ...guide.mapBase.feed, ...guide.mapBase.paint,
      ...guide.mapBase.events, ...guide.mapBase.limits].join("\n");
    for (const fragment of ["createMap", "setZones", "setLots", "setPaint", "fitToBounds",
      "worker-src 'none'", "basemapTemplate: null", "256 KiB"]) {
      expect(all, fragment).toContain(fragment);
    }
  });

  it("should point the ensure/publish/get descriptions at the guide", () => {
    const byName = Object.fromEntries(IMMO_ARTIFACT_MANIFEST.tools.map((tool) => [tool.name, tool.description]));
    for (const name of ["artifacts_ensure", "artifacts_publish", "artifacts_get"]) {
      expect(byName[name]).toContain(AUTHORING_GUIDE_SNIPPET);
      expect(byName[name]).toContain("authoringGuide");
    }
    expect(byName["artifacts_list"]).not.toContain("authoringGuide");
  });

  it("should return the full authoringGuide on ensure/get and a small reference on get_source, receipt fields intact", async () => {
    const receipt = { artifactId: "123e4567-e89b-12d3-a456-426614174000" };
    const ensured = read(await setup(receipt).binding
      .invoke("artifacts_ensure", { bindingName: "x", idempotencyKey: "k" }, authority));
    expect(ensured.artifactId).toBe(receipt.artifactId);
    expect(ensured.authoringGuide.guideId).toBe(AUTHORING_GUIDE_ID);
    const got = read(await setup(receipt).binding
      .invoke("artifacts_get", { artifactId: receipt.artifactId }, authority));
    expect(got.authoringGuide.revision).toBe(AUTHORING_GUIDE_REVISION);
    expect(got.authoringGuide.starter.files.length).toBeGreaterThan(0);
    const source = read(await setup({ artifactId: receipt.artifactId, files: [] }).binding
      .invoke("artifacts_get_source", { artifactId: receipt.artifactId }, authority));
    const sourceData = (source.output ?? source) as Record<string, Record<string, unknown>>;
    const sourceGuide = (sourceData.authoringGuide ?? source.authoringGuide) as Record<string, unknown>;
    expect(sourceGuide.guideId).toBe(AUTHORING_GUIDE_ID);
    expect(sourceGuide.revision).toBe(AUTHORING_GUIDE_REVISION);
    // The small reference keeps identity plus the edit hint only: the
    // broader lifecycle overview already ships on ensure/get.
    expect(sourceGuide).not.toHaveProperty("lifecycle");
    const edit = ((sourceGuide.artifactLifecycle as { edit: string[] }).edit ?? []).join("\n");
    expect(edit).toContain("artifacts_create_upload_page");
    expect(edit).toContain("artifacts_publish_bundle_v2");
    expect(sourceGuide).not.toHaveProperty("starter");
    expect(sourceGuide).not.toHaveProperty("components");
    const published = read(await setup({ releaseId: "r" }).binding.invoke("artifacts_publish",
      { artifactId: receipt.artifactId, files: [{ path: "index.html", mimeType: "text/html", text: "<p>x</p>" }],
        idempotencyKey: "k", ...(ARTIFACT_STRICT ? { expectedCurrentReleaseId: null } : {}) }, authority));
    expect(published.releaseId).toBe("r");
    expect(published.authoringGuide).toBeUndefined();
  });

  it("should leave non-object bodies untouched when attaching the guide", () => {
    expect(withAuthoringGuide("artifacts_ensure", null)).toBeNull();
    expect(withAuthoringGuide("artifacts_ensure", [1])).toEqual([1]);
    expect(withAuthoringGuide("artifacts_list", { a: 1 })).toEqual({ a: 1 });
  });

  it("should ship a starter that is valid against the content-host CSP", () => {
    const guide = getAuthoringGuide();
    const files = Object.fromEntries(guide.starter.files.map((file) => [file.path, file.text]));
    expect(Object.keys(files).sort()).toEqual(["app.css", "app.js", "index.html", "reader.js"]);
    const total = guide.starter.files.reduce((sum, file) => sum + Buffer.byteLength(file.text, "utf8"), 0);
    expect(total).toBeLessThan(256 * 1024);
    const csp = releaseCspForHtml(files["index.html"]!);
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("style-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval/);
    for (const [, url] of files["index.html"]!.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)="([^"]+)"/g)) {
      expect(url!.startsWith("/")).toBe(true);
      expect(url!.startsWith("//")).toBe(false);
      expect(url!.startsWith("/__artifacts/design/") || files[url!.slice(1)] !== undefined).toBe(true);
    }
    // No inline script/style: the release CSP needs no per-page hash.
    expect(files["index.html"]).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    expect(files["index.html"]).not.toContain("<style");
    expect(files["index.html"]).toContain('lang="fr"');
    expect(files["index.html"]).toContain('data-st-theme="sent-tech"');
    for (const asset of DESIGN_KIT_ASSETS) {
      expect(files["index.html"]).toContain(designKitAssetUrl(asset));
    }
    for (const path of ["app.js", "reader.js"]) {
      // The only /api/ segment allowed is the H5 bridge prefix itself.
      expect(files[path].split("/__reader/api/").join("")).not.toContain("/api/");
      expect(files[path]).not.toContain("localStorage");
      expect(files[path]).not.toContain("sessionStorage");
    }
    expect(files["reader.js"]).toContain("workspaces.list.v1");
    expect(files["reader.js"]).toContain("baskets.context.v1");
    expect(files["reader.js"]).toContain("baskets.search.v1");
    expect(files["reader.js"]).toContain("/__reader/renew");
    expect(files["reader.js"]).toContain("/__reader/start");
    expect(files["reader.js"]).toContain("history.replaceState");
    // Author CSS carries no palette of its own: tokens only.
    const css = files["app.css"];
    expect(css).toContain("var(--st-");
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\b(rgb|oklch|hsl)a?\(/);
  });
});
