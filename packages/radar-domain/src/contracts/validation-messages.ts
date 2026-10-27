import { z } from "zod";
/** Messages are an application contract, independent of Zod's defaults. */
export function legacyMessage(code: string, meta: Record<string, unknown>, issue: Record<string, unknown>): string {
  const english = z.locales.en().localeError;
  if (issue.message !== undefined && issue.message !== english(issue as Parameters<typeof english>[0])) {
    return String(issue.message);
  }
  switch (code) {
    case "invalid_type": return meta.received === "undefined" ? "Required" : `Expected ${String(meta.expected)}, received ${String(meta.received)}`;
    case "invalid_string": return meta.validation === "regex" ? "Invalid" : `Invalid ${String(meta.validation)}`;
    case "invalid_literal": return `Invalid literal value, expected ${JSON.stringify(meta.expected)}`;
    case "invalid_enum_value": return `Invalid enum value. Expected ${(meta.options as unknown[]).map((v) => `'${String(v)}'`).join(" | ")}, received '${String(meta.received)}'`;
    case "invalid_union_discriminator": return `Invalid discriminator value. Expected ${(meta.options as unknown[]).map((v) => `'${String(v)}'`).join(" | ")}`;
    case "invalid_union": return "Invalid input";
    case "unrecognized_keys": return `Unrecognized key(s) in object: ${(meta.keys as string[]).map((key) => `'${key}'`).join(", ")}`;
    case "too_small":
    case "too_big": {
      const smaller = code === "too_small";
      const bound = meta[smaller ? "minimum" : "maximum"];
      const quantifier = smaller ? "at least" : "at most";
      if (meta.type === "string") return `String must contain ${quantifier} ${String(bound)} character(s)`;
      if (meta.type === "array") return `Array must contain ${quantifier} ${String(bound)} element(s)`;
      if (meta.type === "number") return `Number must be ${smaller ? "greater" : "less"} than${meta.inclusive ? " or equal to" : ""} ${String(bound)}`;
      break;
    }
  }
  return String(issue.message);
}
