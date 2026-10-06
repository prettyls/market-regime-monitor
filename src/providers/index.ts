import { CharlesSchwabProvider } from "./charles-schwab.js";
import type { MarketDataProvider } from "./provider.js";
import { PropositionMapping } from "./proposition-mapping.js";
import { RestRequestFactory } from "../rest/request-factory.js";

export class ProviderRegistry {
  private readonly providers = new Map<string, MarketDataProvider>();
  constructor(providers?: readonly MarketDataProvider[]) {
    const configuredProviders = providers ?? this.buildProviders();
    configuredProviders.forEach((provider) => this.providers.set(provider.name, provider));
  }

  private buildProviders(): readonly MarketDataProvider[] {
    const proposition = new PropositionMapping().resolveFromEnv(process.env.DATA_PROVIDER);
    if (proposition.providerName === "charles_schwab") {
      return [new CharlesSchwabProvider(fetch, new RestRequestFactory(proposition.apiUrl))];
    }
    throw new Error(`Unsupported provider mapping for proposition: ${proposition.proposition}`);
  }

  get(name: string): MarketDataProvider { const provider = this.providers.get(name); if (!provider) throw new Error(`Unknown provider: ${name}`); return provider; }
}
