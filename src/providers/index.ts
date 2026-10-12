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
  if (refreshToken && (!clientId || !clientSecret)) {
    throw new Error("SCHWAB_REFRESH_TOKEN requires CLIENT_ID and CLIENT_SECRET (or SCHWAB_CLIENT_ID/SCHWAB_CLIENT_SECRET).");
  }

  const expiresAtRaw = readNonEmpty(process.env.SCHWAB_ACCESS_TOKEN_EXPIRES_AT);
  const expiresAt = expiresAtRaw ? Number(expiresAtRaw) : undefined;
  if (expiresAtRaw && (expiresAt === undefined || !Number.isFinite(expiresAt))) {
    throw new Error("SCHWAB_ACCESS_TOKEN_EXPIRES_AT must be a valid epoch-milliseconds number when provided.");
  }

  const redirectUri = readNonEmpty(process.env.SCHWAB_REDIRECT_URI);
  const authConfig: SchwabProviderAuth = {
    accessToken,
    ...(refreshToken ? { refreshToken } : {}),
    ...(clientId ? { clientId } : {}),
    ...(clientSecret ? { clientSecret } : {}),
    ...(redirectUri ? { redirectUri } : {}),
    ...(expiresAt === undefined ? {} : { accessTokenExpiresAt: expiresAt }),
    onTokenUpdate: (tokenData) => {
      process.env.SCHWAB_ACCESS_TOKEN = tokenData.accessToken;
      if (tokenData.refreshToken) process.env.SCHWAB_REFRESH_TOKEN = tokenData.refreshToken;
      else delete process.env.SCHWAB_REFRESH_TOKEN;
      if (tokenData.expiresAt === undefined) delete process.env.SCHWAB_ACCESS_TOKEN_EXPIRES_AT;
      else process.env.SCHWAB_ACCESS_TOKEN_EXPIRES_AT = String(tokenData.expiresAt);
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
