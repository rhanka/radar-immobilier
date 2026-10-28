import { z } from "zod";

/** Zod 3's timestamp grammar: optional seconds and compact offsets, no rewriting. */
export function contractDateTime(options: { offset?: boolean } = {}) {
  const suffix = options.offset ? "(?:Z|[+-]\\d{2}:?\\d{2})" : "Z";
  const pattern = new RegExp("^\\d{4}-\\d{2}-\\d{2}T(?:[01]\\d|2[0-3]):[0-5]\\d"
    + "(?::[0-5]\\d(?:\\.\\d+)?)?" + suffix + "$");
  const day = z.iso.date();
  return z.string().superRefine((value, ctx) => {
    if (!pattern.test(value) || !day.safeParse(value.slice(0, 10)).success) {
      ctx.addIssue({ code: "invalid_format", format: "datetime", message: "Invalid datetime" });
    }
  }).meta({ format: "date-time" });
}
