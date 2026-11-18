import type { Bar } from "../domain/types.js";

export const historyIntervals = ["1d", "1m", "5m", "10m", "15m", "30m", "1h"] as const;
export type HistoryInterval = typeof historyIntervals[number];

export type HistoryRequest = Readonly<{ symbol: string; from?: Date; to?: Date; interval: HistoryInterval }>;
export interface MarketDataProvider { readonly name: string; fetchHistory(request: HistoryRequest): Promise<readonly Bar[]>; }
