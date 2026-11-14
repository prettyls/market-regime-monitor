#!/usr/bin/env tsx
/**
 * Usage: npm run schwab:oauth -- <market|trade> <url|full-redirect-url>
 * Writes only the selected connection's tokens and checks its API access.
 */
import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { EnhancedTokenManager } from "@sudowealth/schwab-api";
import { CharlesSchwabProvider } from "../src/providers/charles-schwab.js";

const readNonEmpty = (...values: Array<string | undefined>): string | undefined => {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
};

const args = process.argv.slice(2);
const connection = args[0];
if (connection !== "market" && connection !== "trade") {
  console.error("Usage: npm run schwab:oauth -- <market|trade> <url|full-redirect-url>");
  process.exit(1);
}
const prefix = connection === "market" ? "SCHWAB_MARKET" : "SCHWAB_TRADE";
const clientId = readNonEmpty(process.env[`${prefix}_CLIENT_ID`]);
const clientSecret = readNonEmpty(process.env[`${prefix}_CLIENT_SECRET`]);
const redirectUri = readNonEmpty(process.env[`${prefix}_REDIRECT_URI`]) ?? "http://localhost";
if (!clientId || !clientSecret) {
  console.error(`${prefix}_CLIENT_ID and ${prefix}_CLIENT_SECRET must be set in .env`);
  process.exit(1);
}

const manager = new EnhancedTokenManager({
  clientId,
  clientSecret,
  redirectUri,
  debug: false,
  load: async () => null,
  save: async () => {},
});

const updateEnvFile = (values: Record<string, string>): void => {
  const envPath = resolve(process.cwd(), ".env");
  let content = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const regex = new RegExp(`^${key}=.*$`, "m");
    content = regex.test(content)
      ? content.replace(regex, line)
      : content + (content.length > 0 && !content.endsWith("\n") ? "\n" : "") + line + "\n";
  }
  writeFileSync(envPath, content);
};

const parseCodeAndState = (input: string): { code: string; state?: string } => {
  try {
    const url = new URL(input);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state") ?? undefined;
    const error = url.searchParams.get("error");
    const errorDescription = url.searchParams.get("error_description");
    if (error) {
      throw new Error(`Schwab returned an OAuth error: ${error}${errorDescription ? ` - ${errorDescription}` : ""}`);
    }
    if (!code) throw new Error(`No "code" query parameter found in: ${input}`);
    return { code, state };
  } catch (err) {
    if (err instanceof TypeError) {
      // Not a valid URL; assume the raw authorization code was pasted instead.
      return { code: input };
    }
    throw err;
  }
};

async function testFetch(accessToken: string, refreshToken?: string): Promise<void> {
  const provider = new CharlesSchwabProvider({
    accessToken,
    ...(refreshToken ? { refreshToken } : {}),
    clientId,
    clientSecret,
    redirectUri,
  });
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
  console.log("\nTesting live API call: GET price history for SPY...");
  const bars = await provider.fetchHistory({ symbol: "SPY", interval: "1d", from, to });
  console.log(`Success: received ${bars.length} bar(s). Most recent:`, bars.at(-1));
}

async function main(): Promise<void> {
  const arg = args[1];

  if (!arg || arg === "url") {
    const { authUrl } = await manager.getAuthorizationUrl();
    console.log("\n1. Open this URL in a browser and log in with your Schwab account:\n");
    console.log(authUrl);
    console.log(
      "\n2. After you approve access, Schwab redirects to your redirect URI" +
        ` (${redirectUri}); the page will likely fail to load (connection refused) - that's expected.`
    );
    console.log("3. Copy the FULL url from the address bar and re-run:\n");
    console.log(`   npm run schwab:oauth -- ${connection} '<pasted-redirect-url>'\n`);
    return;
  }

  const { code, state } = parseCodeAndState(arg);
  console.log(`Exchanging authorization code for tokens (code length: ${code.length})...`);

  let tokenData;
  try {
    tokenData = await manager.exchangeCode(code, state);
  } catch (err) {
    console.error("\nToken exchange failed. This usually means:");
    console.error("  - the authorization code already expired or was already used (codes are single-use, ~30s lifetime)");
    console.error("  - the redirect URI used to request the code doesn't exactly match the selected connection redirect URI");
    console.error("  - selected connection client credentials don't match the app that generated the authorization URL");
    console.error("\nUnderlying error:\n", err);
    process.exit(1);
  }

  console.log("Token exchange succeeded.");
  updateEnvFile({
    [`${prefix}_ACCESS_TOKEN`]: tokenData.accessToken,
    ...(tokenData.refreshToken ? { [`${prefix}_REFRESH_TOKEN`]: tokenData.refreshToken } : {}),
  });
  console.log(
    `Updated .env with ${prefix}_ACCESS_TOKEN${tokenData.refreshToken ? ` and ${prefix}_REFRESH_TOKEN` : " (no refresh token returned)"}.`
  );

  try {
    if (connection === "market") await testFetch(tokenData.accessToken, tokenData.refreshToken);
    else {
      const response = await fetch("https://api.schwabapi.com/trader/v1/accounts?fields=positions", {
        headers: { Authorization: `Bearer ${tokenData.accessToken}` }, signal: AbortSignal.timeout(15000),
      });
      await response.body?.cancel();
      if (!response.ok) throw new Error(`Schwab trading authorization check failed (HTTP ${response.status})`);
      console.log("Trading account authorization verified; no account data displayed.");
    }
  } catch (err) {
    console.error("\nThe new token was issued but the live API call failed. Diagnostics:\n");
    console.error(err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Schwab OAuth flow failed:", err);
  process.exit(1);
});
