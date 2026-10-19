/**
 * Content-origin Host classifier (861c lot H1). Reads the Host header ALONE:
 * X-Forwarded-Host and any other forwarding metadata are never consulted, so
 * a forged forwarded host can divert a request neither onto nor off a content
 * origin. `<artifactUuid>.<base>` is the stable channel and
 * `<releaseUuid>.pinned.<base>` the pinned channel; anything else (extra
 * label, foreign base, bare apex, no base configured) is not a content host.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type ParsedContentHost =
  | { readonly kind: "other" }
  | { readonly kind: "stable"; readonly artifactId: string }
  | { readonly kind: "pinned"; readonly releaseId: string };

export function parseContentHost(
  host: string | null | undefined,
  contentBase: string | null | undefined,
): ParsedContentHost {
  if (!host || !contentBase) return { kind: "other" };
  const base = contentBase.trim().toLowerCase().replace(/\.+$/, "");
  if (base === "") return { kind: "other" };
  let name = host.trim().toLowerCase();
  const colon = name.indexOf(":");
  if (colon !== -1) name = name.slice(0, colon);
  name = name.replace(/\.+$/, "");
  const suffix = `.${base}`;
  if (name === "" || name === base || !name.endsWith(suffix)) {
    return { kind: "other" };
  }
  const labels = name.slice(0, -suffix.length).split(".");
  if (labels.length === 1) {
    const artifactId = labels[0];
    if (artifactId !== undefined && UUID_RE.test(artifactId)) {
      return { kind: "stable", artifactId };
    }
    return { kind: "other" };
  }
  if (labels.length === 2) {
    const [releaseId, scope] = labels;
    if (
      releaseId !== undefined &&
      scope === "pinned" &&
      UUID_RE.test(releaseId)
    ) {
      return { kind: "pinned", releaseId };
    }
  }
  return { kind: "other" };
}
