import { CharlesSchwabProvider, type SchwabProviderAuth } from "./charles-schwab.js";
import { StooqProvider } from "./stooq.js";
import type { MarketDataProvider } from "./provider.js";
import { PropositionMapping } from "./proposition-mapping.js";

const readNonEmpty = (...values: Array<string | undefined>): string | undefined => {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
};

const isExampleValue = (value: string): boolean => /^YOUR_[A-Z0-9_]+$/.test(value);

const resolveSchwabProviderAuthFromEnv = (): SchwabProviderAuth => {
  const accessToken = readNonEmpty(process.env.SCHWAB_ACCESS_TOKEN);
  if (!accessToken) {
    throw new Error(
      "SCHWAB_ACCESS_TOKEN is required when DATA_PROVIDER is Schwab. To enable automatic refresh, also set SCHWAB_REFRESH_TOKEN and CLIENT_ID/CLIENT_SECRET."
    );
  }

  const refreshToken = readNonEmpty(process.env.SCHWAB_REFRESH_TOKEN);
  const clientId = readNonEmpty(process.env.SCHWAB_CLIENT_ID, process.env.CLIENT_ID);
  const clientSecret = readNonEmpty(process.env.SCHWAB_CLIENT_SECRET, process.env.CLIENT_SECRET);
  if (isExampleValue(accessToken) || (refreshToken !== undefined && isExampleValue(refreshToken))) {
    throw new Error(
      "Schwab token configuration contains a .env.example placeholder. Complete the Schwab OAuth authorization-code flow and set the issued SCHWAB_ACCESS_TOKEN and SCHWAB_REFRESH_TOKEN. CLIENT_ID and CLIENT_SECRET cannot authenticate API requests by themselves."
    );
  }
  if (refreshToken && (!clientId || !clientSecret)) {
    throw new Error("SCHWAB_REFRESH_TOKEN requires CLIENT_ID and CLIENT_SECRET (or SCHWAB_CLIENT_ID/SCHWAB_CLIENT_SECRET).");
  }

  delete process.env.SCHWAB_ACCESS_TOKEN_EXPIRES_AT;

  const redirectUri = readNonEmpty(process.env.SCHWAB_REDIRECT_URI);
  const authConfig: SchwabProviderAuth = {
    accessToken,
    ...(refreshToken ? { refreshToken } : {}),
    ...(clientId ? { clientId } : {}),
    ...(clientSecret ? { clientSecret } : {}),
    ...(redirectUri ? { redirectUri } : {}),
    onTokenUpdate: (tokenData) => {
      process.env.SCHWAB_ACCESS_TOKEN = tokenData.accessToken;
      if (tokenData.refreshToken) process.env.SCHWAB_REFRESH_TOKEN = tokenData.refreshToken;
      else delete process.env.SCHWAB_REFRESH_TOKEN;
    },
  };
  return authConfig;
};

export class ProviderRegistry {
  private readonly providers = new Map<string, MarketDataProvider>();
  constructor(providers?: readonly MarketDataProvider[]) {
    const configuredProviders = providers ?? this.buildProviders();
    configuredProviders.forEach((provider) => this.providers.set(provider.name, provider));
  }

  private buildProviders(): readonly MarketDataProvider[] {
    const proposition = new PropositionMapping().resolveFromEnv(process.env.DATA_PROVIDER);
    if (proposition.providerName === "charles_schwab") {
      return [new CharlesSchwabProvider(resolveSchwabProviderAuthFromEnv())];
    }
    if (proposition.providerName === "stooq") {
      return [new StooqProvider(fetch)];
    }
    throw new Error(`Unsupported provider mapping for proposition: ${proposition.proposition}`);
  }

  get(name: string): MarketDataProvider { const provider = this.providers.get(name); if (!provider) throw new Error(`Unknown provider: ${name}`); return provider; }
}
