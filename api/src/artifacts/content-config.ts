/**
 * Artifact content-host config (861c lot H1). ARTIFACTS_CONTENT_BASE is
 * optional: unset or empty stays disabled (closed by default). An explicit but
 * malformed value throws at startup (fail-fast: a mistyped base must stop the
 * process, never run silently disabled). Only hostname syntax is validated
 * here. The address scheme and domain policy are owned by
 * @sentropic/artifacts. `localhost` is accepted as a base for local e2e
 * (`<uuid>.localhost` origins); every other single-label name stays invalid.
 */
export interface ContentHostConfigInput {
  readonly contentBase?: string | undefined;
}

export type ContentHostDisabledReason = "content_base_unset";

export type ContentHostConfig =
  | { readonly enabled: true; readonly contentBase: string }
  | { readonly enabled: false; readonly reason: ContentHostDisabledReason };

const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const HOSTNAME_RE = new RegExp(`^${LABEL}(?:\\.${LABEL})+$`);
const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

export function resolveContentHostConfig(
  input: ContentHostConfigInput,
): ContentHostConfig {
  let raw = (input.contentBase ?? "").trim().toLowerCase();
  if (raw === "") return { enabled: false, reason: "content_base_unset" };
  if (raw.endsWith(".")) raw = raw.slice(0, -1);
  if (raw === "localhost") return { enabled: true, contentBase: raw };
  if (
    raw.length > 253 ||
    raw.includes(":") ||
    raw.includes("/") ||
    IPV4_RE.test(raw) ||
    !HOSTNAME_RE.test(raw)
  ) {
    throw new Error(
      `invalid ARTIFACTS_CONTENT_BASE ${JSON.stringify(input.contentBase)}: expected a bare hostname (e.g. pages.example.net) or localhost`,
    );
  }
  return { enabled: true, contentBase: raw };
}

export interface ContentHostAppOption {
  readonly contentHost?: Extract<ContentHostConfig, { readonly enabled: true }>;
}

/**
 * Map a resolved content-host config to the createApp option spread used in
 * index.ts: disabled resolves to no option (the gate stays unwired), enabled
 * resolves to the wired contentHost. An invalid base never reaches this
 * helper — resolveContentHostConfig throws first.
 */
export function contentHostAppOption(
  resolved: ContentHostConfig,
): ContentHostAppOption {
  if (!resolved.enabled) return {};
  return { contentHost: resolved };
}
