/** Structured test evidence: a different refusal must never qualify a mutant. */
import { expect } from "vitest";

export function writeMutationOutcome(attempt: Promise<unknown>): Promise<string> {
  return attempt.then(() => "committed", (error: unknown) =>
    error instanceof Error ? error.message : "non_error");
}

export function assertMutationOutcome(name: string, observed: string, expected: string): void {
  console.info(`PW_B_MUTATION ${JSON.stringify({ name, expected, observed })}`);
  expect(observed, `PW-B ${name} targeted outcome`).toBe(expected);
}
