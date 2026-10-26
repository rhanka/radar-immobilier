import { resultCivilDates } from "@radar/domain";
import type { SignalTarget } from "./target.js";

export function classificationDay(props: unknown): string | null {
  return resultCivilDates(props, "document").sort().at(-1) ?? null;
}
export const binaryCompare = (left: string, right: string) => Buffer.compare(Buffer.from(left), Buffer.from(right));
export function compareSignalRows(left: { target: SignalTarget; day: string | null }, right: { target: SignalTarget; day: string | null }) {
  if (left.day !== right.day) {
    if (left.day === null) return 1;
    if (right.day === null) return -1;
    return binaryCompare(right.day, left.day);
  }
  return binaryCompare(left.target.type, right.target.type) || binaryCompare(left.target.id, right.target.id);
}
