import { expect, it } from "vitest";
import { validPwPageEnvelope } from "./write-intent-page-envelope.js";
import { prepared, statusOf, UUID, HEX64 } from "./write-intent-page-harness.js";

const expected = { readerSub: "reader", appOrigin: "https://app.example.test", intentId: UUID };
const archive = () => ({ id: UUID, createdAt: "2026-10-28T12:00:00.000Z", scope: "workspace",
  facet: "archive", basket: null, state: "inactive", reason: null, observedFingerprint: HEX64 });

it("accepte les discriminants chaînes du contrat publié", () => {
  expect(validPwPageEnvelope(prepared(UUID).body, { ...expected, verb: "prepare" })).toBe(true);
  expect(validPwPageEnvelope(statusOf(UUID, "pending").body, { ...expected, verb: "status" })).toBe(true);
  expect(validPwPageEnvelope(statusOf(UUID, "committed").body, { ...expected, verb: "status" })).toBe(true);
  expect(validPwPageEnvelope(statusOf(UUID, "committed", { receipt: { event: archive() } }).body,
    { ...expected, verb: "status" })).toBe(true);
});

it.each(["prepare", "status"] as const)("refuse un tableau à un élément pour l’état %s", (verb) => {
  const value = verb === "prepare" ? prepared(UUID).body : statusOf(UUID, "committed").body;
  const malformed = { ...value, data: { ...value.data, state: [value.data.state] } };
  expect(validPwPageEnvelope(malformed, { ...expected, verb })).toBe(false);
});

it.each(["scope", "facet", "state", "basket"])("refuse un tableau à un élément pour le discriminant %s du reçu", (field) => {
  const event: Record<string, unknown> = field === "basket"
    ? { ...archive(), scope: "personal", facet: "selection", basket: "pertinent" } : archive();
  event[field] = [event[field]];
  const value = statusOf(UUID, "committed", { receipt: { event } }).body;
  expect(validPwPageEnvelope(value, { ...expected, verb: "status" })).toBe(false);
});
