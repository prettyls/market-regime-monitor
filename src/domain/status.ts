import type { PatternSignal } from "./types.js";

export type MarketStatus = "NORMAL" | "WARNING" | "ALERT";

export const statusColors: Readonly<Record<MarketStatus, string>> = { NORMAL: "green", WARNING: "orange", ALERT: "red" };

export function classifyStatus(signals: readonly PatternSignal[]): MarketStatus {
  const breakout = signals.find((signal) => signal.pattern === "breakout");
  if (breakout?.state === "CONFIRMED_UP" || breakout?.state === "CONFIRMED_DOWN") return "ALERT";
  const trend = signals.find((signal) => signal.pattern === "trend");
  if (trend?.state === "UP" || trend?.state === "DOWN") return "WARNING";
  return "NORMAL";
}

export function withStatus<T extends { signals: unknown }>(analysis: T): T & { status: MarketStatus; color: string } {
  const status = classifyStatus(Array.isArray(analysis.signals) ? (analysis.signals as PatternSignal[]) : []);
  return { ...analysis, status, color: statusColors[status] };
}
