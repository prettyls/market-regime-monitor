import type { Bar } from "../domain/types.js";

export type HistoryRequest = Readonly<{ symbol: string; from?: Date; to?: Date; interval: "1d" }>;
export interface MarketDataProvider { readonly name: string; fetchHistory(request: HistoryRequest): Promise<readonly Bar[]>; }
