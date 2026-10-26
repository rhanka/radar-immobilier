import { z } from "zod";
import type { ReaderOperationName } from "./reader-operations.js";

const geoResponse = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(z.object({ zoneCode: z.string(), citySlug: z.string() }).strict()).max(100),
}).strict();
const signal = z.object({ id: z.string(), city: z.string(), kind: z.string(), detail: z.string().nullable() }).strict();
const signalsResponse = z.object({ city: z.string(), reader: z.string(), signals: z.array(signal) }).strict();

/** A bound adapter must normalize receiving API results into these shapes. */
export function validateReaderResponse(op: ReaderOperationName, value: unknown, readerSub: string): Record<string, unknown> {
  if (op === "geo.read.v1") return geoResponse.parse(value);
  if (op !== "signals.protected-read.v1") throw new Error("Capability unavailable");
  const response = signalsResponse.parse(value);
  if (response.reader !== readerSub) throw new Error("Reader identity mismatch");
  return response;
}
