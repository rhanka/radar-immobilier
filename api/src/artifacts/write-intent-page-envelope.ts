/** Shared pure validator: these exact bytes also run in the served page.
 * Closed fields prevent accidental private data at the H5 -> content boundary.
 */
export function validPwPageEnvelope(value: unknown, expected: {
  verb: "prepare" | "status"; readerSub: string; appOrigin: string; intentId?: string;
}): boolean {
  const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every((key) => allowed.includes(key));
  const uuid = (v: unknown) => typeof v === "string" && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
  const date = (v: unknown) => typeof v === "string" &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v));
  if (typeof expected.readerSub !== "string" || expected.readerSub.length === 0 ||
    typeof expected.appOrigin !== "string" || !expected.appOrigin.startsWith("https://")) return false;
  if (!record(value) || !keys(value, ["operation", "reader", "data"]) ||
    value.operation !== `facets.write-intents.${expected.verb}.v1` || !record(value.reader) ||
    !keys(value.reader, ["sub"]) || value.reader.sub !== expected.readerSub || !record(value.data)) return false;
  const data = value.data, id = data.intentId;
  if (!uuid(id) || (expected.intentId !== undefined && id !== expected.intentId) ||
    !["pending", "committed", "rejected", "expired", "revoked"].includes(String(data.state))) return false;
  if (expected.verb === "prepare") {
    return keys(data, ["intentId", "invocationId", "state", "expiresAt", "confirmationUrl", "managementUrl", "statusUrl"]) &&
      uuid(data.invocationId) && date(data.expiresAt) &&
      data.confirmationUrl === `${expected.appOrigin}/artifact-write/intents/${id}` &&
      data.managementUrl === `${expected.appOrigin}/api/v1/artifacts/write-intents/${id}` &&
      data.statusUrl === `${expected.appOrigin}/api/v1/artifacts/reader/facets/write-intents/${id}`;
  }
  if (data.state === "pending") return keys(data, ["intentId", "state", "expiresAt"]) && date(data.expiresAt);
  if (data.state === "expired" || data.state === "revoked") return keys(data, ["intentId", "state"]);
  if (data.state === "rejected") return keys(data, ["intentId", "state", "error"]) && record(data.error) &&
    keys(data.error, ["code"]) && typeof data.error.code === "string";
  if (!keys(data, ["intentId", "state", "commandId", "receipt", "nextAction"]) || !uuid(data.commandId) ||
    data.nextAction !== "refresh_state" || !record(data.receipt) || !keys(data.receipt, ["event"])) return false;
  const event = data.receipt.event;
  if (event === null) return true; // BASE's authorized no-op receipt.
  if (!record(event) || !keys(event, ["id", "createdAt", "scope", "facet", "basket", "state", "reason", "observedFingerprint"]) ||
    !uuid(event.id) || !date(event.createdAt) || !["personal", "workspace"].includes(String(event.scope)) ||
    !["selection", "archive"].includes(String(event.facet)) || !["active", "inactive"].includes(String(event.state)) ||
    typeof event.observedFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(event.observedFingerprint)) return false;
  if (event.facet === "selection" ? event.scope !== "personal" || !["pertinent", "a_surveiller"].includes(String(event.basket))
    : event.basket !== null) return false;
  if (event.reason !== null && (!record(event.reason) || !keys(event.reason, ["profileId", "code", "verdict"]) ||
    typeof event.reason.profileId !== "string" || event.reason.profileId.length === 0 ||
    typeof event.reason.code !== "string" || event.reason.code.length === 0 ||
    event.reason.verdict !== (event.facet === "archive" ? "non_pertinent" : event.basket))) return false;
  return (event.state !== "inactive" || event.reason === null) &&
    !(event.facet === "archive" && event.state === "active" && event.reason === null);
}
