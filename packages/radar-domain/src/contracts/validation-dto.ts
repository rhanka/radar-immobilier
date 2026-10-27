import { z } from "zod";
import { legacyIssue } from "./validation-issues.js";

export interface ContractDetail {
  code: string;
  path: (string | number)[];
  message: string;
  [key: string]: unknown;
}

/** Project wire contract: keep validation internals out of HTTP responses. */
export function toContractDetails(
  issues: readonly unknown[], schema?: z.ZodType, input?: unknown,
): ContractDetail[] {
  return issues.map((issue) => legacyIssue(
    issue as Record<string, unknown>, schema, input,
  ));
}

type ErrorTree = { _errors: string[]; [key: string]: unknown };
export function toErrorTree(details: readonly ContractDetail[]): ErrorTree {
  const tree: ErrorTree = { _errors: [] };
  const add = (detail: ContractDetail) => {
    if (detail.code === "invalid_union" && Array.isArray(detail.unionErrors)) {
      for (const branch of detail.unionErrors as { issues: ContractDetail[] }[]) branch.issues.forEach(add);
      return;
    }
    let node = tree;
    for (const segment of detail.path) {
      const key = String(segment);
      if (!Object.hasOwn(node, key)) Object.defineProperty(node, key, {
        value: { _errors: [] }, enumerable: true, writable: true, configurable: true,
      });
      node = node[key] as ErrorTree;
    }
    node._errors.push(detail.message);
  };
  details.forEach(add);
  return tree;
}

export function contractSafeParse<S extends z.ZodType>(schema: S, input: unknown) {
  const parsed = schema.safeParse(input, { reportInput: true });
  if (parsed.success) return parsed;
  const issues = toContractDetails(parsed.error.issues, schema, input);
  return { success: false as const, error: {
    issues, format: () => toErrorTree(issues), message: JSON.stringify(issues, null, 2),
  } };
}

export function contractParse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = contractSafeParse(schema, input);
  if (result.success) return result.data;
  throw new Error(result.error.message);
}

export function isNonFiniteNumber(value: unknown): boolean {
  return typeof value === "number" && !Number.isFinite(value);
}
