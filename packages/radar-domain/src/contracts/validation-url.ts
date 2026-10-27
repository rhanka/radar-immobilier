import { z } from "zod";

/** Validate with the URL parser, as Zod 3 did, but never rewrite the source value. */
export function contractUrl(schema: z.ZodString = z.string()) {
  return schema.superRefine((value, ctx) => {
    try { new URL(value); } catch {
      ctx.addIssue({ code: "invalid_format", format: "url", message: "Invalid url" });
    }
  }).meta({ format: "uri" });
}
