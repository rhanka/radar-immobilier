/**
 * Client for the 6K cutover status endpoint.
 *
 * Fail-closed: any transport failure, non-OK status, or malformed body
 * leaves the destination unavailable, never selecting sealed legacy
 * storage. Only an explicit, readable pre-cutover status selects legacy.
 */

export interface CutoverPendingTarget {
  targetKey: string;
  cause: string;
}

export interface LotCutoverStatus {
  maintenanceBarrier: boolean;
  destinationOpen: boolean;
  manifestSha: string | null;
  activatedAt: string | null;
  unavailable: string[];
  pending: CutoverPendingTarget[];
}

/** Display source: facets only when the destination is positively open. */
export function cutoverDisplayMode(status: LotCutoverStatus | null): "facets" | "legacy" | "unavailable" {
  if (!status) return "unavailable";
  if (status.destinationOpen) return "facets";
  return status.maintenanceBarrier ? "unavailable" : "legacy";
}

function apiUrl(path: string, baseUrl = import.meta.env.VITE_API_BASE_URL ?? ""): string {
  const base = baseUrl ? baseUrl.replace(/\/$/, "") : "";
  return `${base}${path}`;
}

function isPendingTarget(value: unknown): value is CutoverPendingTarget {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate["targetKey"] === "string" && typeof candidate["cause"] === "string";
}

/** Fetch the cutover status; throws on any non-OK or malformed response. */
export async function fetchLotCutoverStatus(
  workspaceId: string,
  baseUrl?: string,
): Promise<LotCutoverStatus> {
  const res = await fetch(
    apiUrl(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/lot-facets/cutover`, baseUrl),
  );
  if (!res.ok) throw new Error(`lot cutover status HTTP ${res.status}`);
  const body = (await res.json()) as {
    ok?: boolean;
    maintenanceBarrier?: boolean;
    destinationOpen?: boolean;
    manifestSha?: string | null;
    activatedAt?: string | null;
    unavailable?: unknown;
    pending?: unknown;
  };
  if (
    !body ||
    body.ok !== true ||
    typeof body.maintenanceBarrier !== "boolean" ||
    typeof body.destinationOpen !== "boolean" ||
    !(body.manifestSha === null || (typeof body.manifestSha === "string" && /^[a-f0-9]{64}$/.test(body.manifestSha))) ||
    !(body.activatedAt === null || (typeof body.activatedAt === "string" && Number.isFinite(Date.parse(body.activatedAt)))) ||
    (body.destinationOpen && (!body.maintenanceBarrier || body.manifestSha === null || body.activatedAt === null)) ||
    !Array.isArray(body.unavailable) ||
    !body.unavailable.every((entry) => typeof entry === "string") ||
    !Array.isArray(body.pending) ||
    !body.pending.every(isPendingTarget)
  ) {
    throw new Error("lot cutover status: api returned an unexpected body");
  }
  return {
    maintenanceBarrier: body.maintenanceBarrier,
    destinationOpen: body.destinationOpen,
    manifestSha: typeof body.manifestSha === "string" ? body.manifestSha : null,
    activatedAt: typeof body.activatedAt === "string" ? body.activatedAt : null,
    unavailable: [...body.unavailable],
    pending: body.pending.map((entry) => ({ ...entry })),
  };
}
