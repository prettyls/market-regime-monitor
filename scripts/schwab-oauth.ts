#!/usr/bin/env tsx
/**
 * One-off helper to run the Schwab OAuth authorization-code flow and store the
 * resulting access/refresh tokens in `.env`.
 *
 * Usage:
 *   tsx scripts/schwab-oauth.ts
 *     -> prints the authorization URL to open in a browser
 *
 *   tsx scripts/schwab-oauth.ts '<redirect-url-you-were-sent-to-after-approving>'
 *     -> exchanges the `code` (and `state`, for PKCE) in that URL for tokens,
 *        writes them to `.env`, and runs a live price-history request to
 *        confirm the Schwab API actually accepts the new token.
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

const clientId = readNonEmpty(process.env.CLIENT_ID, process.env.SCHWAB_CLIENT_ID);
const clientSecret = readNonEmpty(process.env.CLIENT_SECRET, process.env.SCHWAB_CLIENT_SECRET);
const redirectUri = readNonEmpty(process.env.SCHWAB_REDIRECT_URI) ?? "http://localhost";

if (!clientId || !clientSecret) {
  console.error("CLIENT_ID and CLIENT_SECRET (or SCHWAB_CLIENT_ID/SCHWAB_CLIENT_SECRET) must be set in .env");
  process.exit(1);
}

const manager = new EnhancedTokenManager({
  clientId,
  clientSecret,
  redirectUri,
  debug: true,
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
  const arg = process.argv[2];

  if (!arg || arg === "url") {
    const { authUrl } = await manager.getAuthorizationUrl();
    console.log("\n1. Open this URL in a browser and log in with your Schwab account:\n");
    console.log(authUrl);
    console.log(
      "\n2. After you approve access, Schwab redirects to your redirect URI" +
        ` (${redirectUri}); the page will likely fail to load (connection refused) - that's expected.`
    );
    console.log("3. Copy the FULL url from the address bar and re-run:\n");
    console.log("   npm run schwab:oauth -- '<pasted-redirect-url>'\n");
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
    console.error("  - the redirect URI used to request the code doesn't exactly match SCHWAB_REDIRECT_URI");
    console.error("  - CLIENT_ID/CLIENT_SECRET don't match the app that generated the authorization URL");
    console.error("\nUnderlying error:\n", err);
    process.exit(1);
  }

  console.log("Token exchange succeeded.");
  updateEnvFile({
    SCHWAB_ACCESS_TOKEN: tokenData.accessToken,
    ...(tokenData.refreshToken ? { SCHWAB_REFRESH_TOKEN: tokenData.refreshToken } : {}),
  });
  console.log(
    `Updated .env with new SCHWAB_ACCESS_TOKEN${tokenData.refreshToken ? " and SCHWAB_REFRESH_TOKEN" : " (no refresh token returned)"}.`
  );

  try {
    await testFetch(tokenData.accessToken, tokenData.refreshToken);
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
