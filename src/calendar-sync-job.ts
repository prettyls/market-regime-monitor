import "dotenv/config";
import { prisma } from "./db.js";
import { syncCalendar } from "./trading/calendar-sync.js";
import { configuredSchwabAccountHash } from "./trading/policy.js";
import { SchwabPortfolioError } from "./trading/schwab.js";

try {
  console.log(await syncCalendar(prisma, configuredSchwabAccountHash()));
} catch (error) {
  if (error instanceof SchwabPortfolioError) {
    console.error({ code: error.code, message: error.message, upstreamStatus: error.upstreamStatus });
  } else {
    console.error("Schwab calendar sync failed");
  }
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
