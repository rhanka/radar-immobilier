import { z } from "zod";
import type { ContractDetail } from "./validation-dto.js";
import { legacyMessage } from "./validation-messages.js";

type SchemaView = z.ZodType & {
  shape?: Record<string, z.ZodType>; element?: z.ZodType;
  options?: readonly (z.ZodType | string)[]; values?: Set<unknown>;
  unwrap?: () => z.ZodType; in?: z.ZodType;
};
export function schemaAtPath(schema: z.ZodType | undefined, path: PropertyKey[], input: unknown): SchemaView | undefined {
  let current = schema as SchemaView | undefined;
  for (let depth = 0; current && depth < 20; depth++) {
    if (current.unwrap && !(current instanceof z.ZodArray)) { current = current.unwrap() as SchemaView; continue; }
    if (current.in) { current = current.in as SchemaView; continue; }
    if (current.options?.[0] instanceof z.ZodType && !path.length) return current;
    if (current.options?.[0] instanceof z.ZodType) {
      const options = current.options as readonly SchemaView[];
      current = options.find((option) => Object.entries(option.shape ?? {}).some(([key, field]) =>
        field instanceof z.ZodLiteral && [...field.values].some((value) => value === (input as Record<string, unknown> | null)?.[key]),
      )) ?? options[0];
      continue;
    }
    if (!path.length) return current;
    const [head, ...tail] = path;
    return schemaAtPath(current.shape?.[String(head)] ?? current.element, tail,
      (input as Record<string, unknown> | null)?.[String(head)]);
  }
  return current;
}

export function legacyIssue(issue: Record<string, unknown>, schema?: z.ZodType, root?: unknown): ContractDetail {
  const path = (issue.path ?? []) as (string | number)[];
  const contract = (issue.params as { contract?: ContractDetail } | undefined)?.contract;
  if (contract) return { ...contract, path };
  const field = schemaAtPath(schema, path, root);
  const input = issue.input;
  const type = input === null ? "null" : Array.isArray(input) ? "array" : typeof input;
  const code = String(issue.code);
  let extra: Record<string, unknown> = {};
  let wireCode = code;
  if (code === "invalid_type") {
    const expected = issue.expected === "int" ? "integer" : issue.expected === "record" ? "object" : issue.expected;
    extra = { expected, received: issue.expected === "int" ? "float" : type };
    if (issue.received === "NaN") extra.received = "nan";
    if (typeof input === "number" && !Number.isFinite(input) && !Number.isNaN(input)) {
      return { code: "not_finite", path, message: "Number must be finite" };
    }
  } else if (code === "invalid_format") {
    wireCode = "invalid_string";
    extra = { validation: issue.format === "guid" ? "uuid" : issue.format };
  } else if (code === "invalid_value") {
    const values = issue.values as unknown[];
    if (field?.options && !(field.options[0] instanceof z.ZodType)) {
      wireCode = type !== "string" ? "invalid_type" : "invalid_enum_value";
      extra = wireCode === "invalid_type"
        ? { expected: values.map((v) => `'${String(v)}'`).join(" | "), received: type }
        : { received: input, options: values };
    } else {
      wireCode = "invalid_literal";
      extra = { received: input, expected: values[0] };
    }
  } else if (code === "too_small" || code === "too_big") {
    const bound = code === "too_small" ? "minimum" : "maximum";
    extra = { [bound]: issue[bound], type: issue.origin, inclusive: issue.inclusive, exact: false };
  } else if (code === "unrecognized_keys") {
    extra = { keys: issue.keys };
  } else if (code === "invalid_union" && issue.discriminator) {
    wireCode = "invalid_union_discriminator";
    const parent = schemaAtPath(schema, path.slice(0, -1), root);
    const choices = (parent?.options ?? []) as SchemaView[];
    extra = { options: choices.flatMap((option) => [...((option.shape?.[String(issue.discriminator)] as SchemaView)?.values ?? [])]) };
  } else if (code === "invalid_union") {
    const branches = issue.errors as Record<string, unknown>[][];
    extra = { unionErrors: branches.map((errors, i) => ({ issues: errors.map((error) =>
      legacyIssue(error, (field?.options as z.ZodType[] | undefined)?.[i], input)), name: "ZodError" })) };
  }
  const message = legacyMessage(wireCode, extra, issue);
  // Text diagnostics persist JSON.stringify(issues), including property order.
  if (wireCode === "invalid_string") return { ...extra, code: wireCode, message, path };
  if (wireCode === "invalid_enum_value") return {
    received: extra.received, code: wireCode, options: extra.options, path, message,
  };
  if (wireCode === "invalid_literal") return {
    received: extra.received, code: wireCode, expected: extra.expected, path, message,
  };
  if (wireCode === "invalid_type" && code === "invalid_value") return { ...extra, code: wireCode, path, message };
  if (wireCode === "invalid_type" && issue.expected !== "int"
    || ["invalid_union", "invalid_union_discriminator", "unrecognized_keys"].includes(wireCode)) {
    return { code: wireCode, ...extra, path, message };
  }
  return { code: wireCode, ...extra, message, path };
}
