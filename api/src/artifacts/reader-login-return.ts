/** Only the local reader restart route may survive the existing OIDC flow. */
export function readerLoginReturn(value: unknown, appBaseUrl: string): string | undefined {
  if (typeof value !== "string" || value.length > 2048 || !value.startsWith("/") || value.startsWith("//")) return;
  try {
    const url = new URL(value, appBaseUrl);
    if (url.origin !== new URL(appBaseUrl).origin || url.pathname !== "/api/v1/artifacts/reader/resume" || url.hash ||
      url.searchParams.getAll("origin").length !== 1 || [...url.searchParams.keys()].some((key) => key !== "origin")) return;
    return url.pathname + url.search;
  } catch { return; }
}
