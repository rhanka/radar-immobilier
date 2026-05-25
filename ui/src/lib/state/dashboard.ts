import type {
  RadarOpportunity,
  RadarSignal,
} from "../demo/radar-demo-data";
import { getDashboardMetrics, getSignalById } from "../demo/radar-demo-data";

export interface DashboardState {
  signals: RadarSignal[];
  opportunity: RadarOpportunity;
  selectedSignal: RadarSignal;
  metrics: ReturnType<typeof getDashboardMetrics>;
}

export function createDashboardState(
  signals: RadarSignal[],
  opportunity: RadarOpportunity,
  selectedSignalId?: string,
): DashboardState {
  const selectedSignal =
    (selectedSignalId ? getSignalById(signals, selectedSignalId) : undefined) ??
    signals[0];

  if (!selectedSignal) {
    throw new Error("Dashboard requires at least one signal");
  }

  return {
    signals,
    opportunity,
    selectedSignal,
    metrics: getDashboardMetrics(signals, opportunity),
  };
}
