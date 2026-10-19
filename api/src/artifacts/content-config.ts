/**
 * Artifact content-host config (861c lot H1). ARTIFACTS_CONTENT_BASE is
 * optional: unset stays disabled (closed by default). Only hostname syntax
 * is validated here. The address scheme and domain policy are owned by
 * @sentropic/artifacts (design #692 in progress).
 */
export interface ContentHostConfigInput {
  readonly contentBase?: string | undefined;
}

export type ContentHostDisabledReason =
  | "content_base_unset"
  | "content_base_invalid";

export type ContentHostConfig =
  | { readonly enabled: true; readonly contentBase: string }
  | { readonly enabled: false; readonly reason: ContentHostDisabledReason };

const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const HOSTNAME_RE = new RegExp(`^${LABEL}(?:\\.${LABEL})+$`);
const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

export function resolveContentHostConfig(
  input: ContentHostConfigInput,
): ContentHostConfig {
  const raw = (input.contentBase ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (raw === "") return { enabled: false, reason: "content_base_unset" };
  if (
    raw.length > 253 ||
    raw.includes(":") ||
    raw.includes("/") ||
    IPV4_RE.test(raw) ||
    !HOSTNAME_RE.test(raw)
  ) {
    return { enabled: false, reason: "content_base_invalid" };
  }
  return { enabled: true, contentBase: raw };
}
