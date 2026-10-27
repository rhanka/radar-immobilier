import { z } from "zod";

/**
 * Finite-number field for network-validated numbers (D6).
 * Keeps the historic positive/min/max checks; the project DTO maps the
 * v4 non-finite type rejection to the `not_finite` contract diagnostic.
 */
export function finitePositiveOptional() {
  return finitePositive().optional();
}

export function finitePositive() {
  return z.number({ error: (issue) =>
    typeof issue.input === "number" && !Number.isFinite(issue.input)
      ? "Number must be finite" : undefined,
  }).positive();
}
