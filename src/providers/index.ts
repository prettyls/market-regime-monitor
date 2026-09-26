import { CboeVixProvider } from "./cboe.js";
import type { MarketDataProvider } from "./provider.js";
import { StooqProvider } from "./stooq.js";

export class ProviderRegistry {
  private readonly providers = new Map<string, MarketDataProvider>();
  constructor(providers: readonly MarketDataProvider[] = [new StooqProvider(), new CboeVixProvider()]) { providers.forEach((provider) => this.providers.set(provider.name, provider)); }
  get(name: string): MarketDataProvider { const provider = this.providers.get(name); if (!provider) throw new Error(`Unknown provider: ${name}`); return provider; }
}
