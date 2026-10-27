import { z } from "zod";

/** Keep integer checks continuable and avoid Zod 4's implicit safe-integer bound. */
export function contractInteger(options: { coerce?: boolean } = {}) {
  const schema = options.coerce ? z.coerce.number() : z.number();
  return schema.refine(Number.isInteger, {
    message: "Expected integer, received float",
    params: { contract: { code: "invalid_type", expected: "integer", received: "float",
      message: "Expected integer, received float" } },
  });
}
