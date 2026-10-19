
import { resolveContentPath } from "@sentropic/artifacts/content/routing";

export interface PublishFileInput {
  readonly path: string;
  readonly mediaType: string;
    readonly sizeBytes: number;
}

export const PUBLISH_MAX_FILES = 32;
export const PUBLISH_MAX_FILE_BYTES = 256 * 1024;
export const BINDING_NAME_MAX_LENGTH = 128;

const ALLOWED_MEDIA_TYPES = new Set([
  "text/html",
  "text/css",
  "text/javascript",
  "application/json",
]);

const RESERVED_FIRST_SEGMENTS = new Set(["api", "__artifacts", "livez", "health"]);

function isPlainPath(path: string): boolean {
  if (path === "" || path.includes("\\") || path.includes("%")) return false;
  const segments = path.split("/");
  if (segments.some((segment) => segment === "")) return false;
  if (segments.some((segment) => segment === "." || segment === "..")) return false;
  return resolveContentPath(`/${path}`) === path && !/[?#]/.test(path) &&
    !Array.from(path).some((character) => character.charCodeAt(0) < 32);
}

export function validatePublishFilePath(path: string): string[] {
  if (!isPlainPath(path)) {
    return [
      `invalid path ${JSON.stringify(path)}: refusing empty segments, ".", "..", backslashes and percent-encoding`,
    ];
  }
  const first = path.split("/")[0]!;
  if (RESERVED_FIRST_SEGMENTS.has(first)) {
    return [`reserved path ${JSON.stringify(path)}: first segment is reserved`];
  }
  return [];
}

function validatePublishFileMediaType(mediaType: string, path: string): string[] {
  if (!ALLOWED_MEDIA_TYPES.has(mediaType)) {
    return [
      `unsupported media type ${JSON.stringify(mediaType)} for ${JSON.stringify(path)}: allowed text/html, text/css, text/javascript, application/json`,
    ];
  }
  return [];
}

function validatePublishFileSize(sizeBytes: number, path: string): string[] {
  if (!Number.isInteger(sizeBytes) || sizeBytes < 0) {
    return [`invalid size for ${JSON.stringify(path)}: expected an integer >= 0`];
  }
  if (sizeBytes > PUBLISH_MAX_FILE_BYTES) {
    return [
      `file ${JSON.stringify(path)} exceeds 256 KiB decoded (${sizeBytes} bytes)`,
    ];
  }
  return [];
}

export function validatePublishFiles(files: readonly PublishFileInput[]): string[] {
  const violations: string[] = [];
  if (files.length === 0) {
    return ["manifest must list at least one file"];
  }
  if (files.length > PUBLISH_MAX_FILES) {
    violations.push(
      `manifest lists ${files.length} files, at most ${PUBLISH_MAX_FILES} are allowed`,
    );
  }
  const seen = new Set<string>();
  if (files.reduce((sum, file) => sum + file.sizeBytes, 0) > PUBLISH_MAX_FILE_BYTES) {
    violations.push("manifest exceeds 256 KiB decoded");
  }
  for (const file of files) {
    violations.push(...validatePublishFilePath(file.path));
    violations.push(...validatePublishFileMediaType(file.mediaType, file.path));
    violations.push(...validatePublishFileSize(file.sizeBytes, file.path));
    if (seen.has(file.path)) {
      violations.push(`duplicate path ${JSON.stringify(file.path)}`);
    }
    seen.add(file.path);
  }
  return violations;
}

export function validateBindingName(name: string): string[] {
  if (name === "") return ["binding name must not be empty"];
  if (name.length > BINDING_NAME_MAX_LENGTH) {
    return [
      `binding name exceeds ${BINDING_NAME_MAX_LENGTH} characters (${name.length})`,
    ];
  }
  return [];
}
