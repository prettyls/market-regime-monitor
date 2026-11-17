import "dotenv/config";
import { tradeAccessToken } from "./trading/token.js";
import { prisma } from "./db.js";

try {
  if (process.env.SCHWAB_TRADE_TOKEN_STORE !== "database") throw new Error("SCHWAB_TRADE_TOKEN_STORE=database is required");
  await tradeAccessToken(true);
  console.log("Schwab trade token refreshed and persisted");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Trade token refresh failed");
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }
