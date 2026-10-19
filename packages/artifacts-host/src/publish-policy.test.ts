import { describe, expect, it } from "vitest";
import {
  BINDING_NAME_MAX_LENGTH,
  PUBLISH_MAX_FILE_BYTES,
  PUBLISH_MAX_FILES,
  validateBindingName,
  validatePublishFilePath,
  validatePublishFiles,
  type PublishFileInput,
} from "./publish-policy.js";

function file(overrides: Partial<PublishFileInput> = {}): PublishFileInput {
  return {
    path: "index.html",
    mediaType: "text/html",
    sizeBytes: 1240,
    ...overrides,
  };
}

describe("validatePublishFilePath", () => {
  it("accepts ordinary nested paths", () => {
    for (const path of ["index.html", "assets/app.abc123.js", "a/b/c.css"]) {
      expect(validatePublishFilePath(path), path).toEqual([]);
    }
  });

  it("refuses traversal, backslashes, empty segments and encoding", () => {
    const bad = [
      "../secret",
      "a/../../b",
      "..",
      ".",
      "a\\b",
      "a//b",
      "/leading",
      "trailing/",
      "",
      "a/%2e%2e/b",
      "caf%C3%A9.html",
      "100%.html",
    ];
    for (const path of bad) {
      expect(validatePublishFilePath(path), path).not.toEqual([]);
    }
  });

  it("refuses reserved first segments and probe paths", () => {
    for (const path of ["api/data.json", "__artifacts/x", "livez", "health", "livez/old", "health/check"]) {
      expect(validatePublishFilePath(path), path).not.toEqual([]);
    }
  });

  it("keeps similarly-prefixed names that are not reserved", () => {
    for (const path of ["apiary/index.html", "healthy.html", "livezy.css"]) {
      expect(validatePublishFilePath(path), path).toEqual([]);
    }
  });
});

describe("validatePublishFiles", () => {
  it("bounds the total decoded manifest and refuses noncanonical MIME types", () => {
    expect(validatePublishFiles([file({ sizeBytes: 150000 }), file({ path: "a.css", sizeBytes: 150000 })])).not.toEqual([]);
    expect(validatePublishFiles([file({ mediaType: "TEXT/HTML" })])).not.toEqual([]);
    expect(validatePublishFiles([file({ mediaType: "text/html; charset=utf-8" })])).not.toEqual([]);
  });
  it("accepts the documented fork manifest", () => {
    expect(
      validatePublishFiles([
        file({ path: "index.html", mediaType: "text/html", sizeBytes: 1240 }),
        file({ path: "assets/app.abc123.js", mediaType: "text/javascript", sizeBytes: 45200 }),
      ]),
    ).toEqual([]);
  });

  it("accepts all four canonical media types", () => {
    const files = ["text/html", "text/css", "text/javascript", "application/json"].map(
      (mediaType, i) => file({ path: `f${i}.dat`, mediaType }),
    );
    expect(validatePublishFiles(files)).toEqual([]);
  });

  it("refuses an empty manifest, too many files and text/plain", () => {
    expect(validatePublishFiles([])).not.toEqual([]);
    const tooMany = Array.from({ length: PUBLISH_MAX_FILES + 1 }, (_, i) =>
      file({ path: `f${i}.html` }),
    );
    expect(validatePublishFiles(tooMany).join("\n")).toContain(
      `at most ${PUBLISH_MAX_FILES}`,
    );
    expect(
      validatePublishFiles([file({ mediaType: "text/plain" })]).join("\n"),
    ).toContain("unsupported media type");
  });

  it("refuses duplicate paths and oversized or invalid sizes", () => {
    expect(
      validatePublishFiles([file(), file({ mediaType: "text/css" })]).join("\n"),
    ).toContain("duplicate path");
    expect(
      validatePublishFiles([file({ sizeBytes: PUBLISH_MAX_FILE_BYTES + 1 })]).join("\n"),
    ).toContain("256 KiB");
    expect(validatePublishFiles([file({ sizeBytes: PUBLISH_MAX_FILE_BYTES })])).toEqual([]);
    for (const sizeBytes of [-1, 1.5, Number.NaN]) {
      expect(validatePublishFiles([file({ sizeBytes })]), String(sizeBytes)).not.toEqual([]);
    }
  });
});

describe("validateBindingName", () => {
  it("accepts a bounded name and refuses empty or overlong names", () => {
    expect(validateBindingName("vue:carte-alice")).toEqual([]);
    expect(validateBindingName("")).not.toEqual([]);
    expect(validateBindingName("x".repeat(BINDING_NAME_MAX_LENGTH))).toEqual([]);
    expect(validateBindingName("x".repeat(BINDING_NAME_MAX_LENGTH + 1)).join("\n")).toContain(
      String(BINDING_NAME_MAX_LENGTH),
    );
  });
});
