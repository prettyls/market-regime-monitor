import "dotenv/config";
import { prisma } from "./db.js";
import { executePaperDay, reportPaperDay } from "./paper/service.js";
import { paperConfig, sessionDate } from "./paper/config.js";
import { ProviderRegistry } from "./providers/index.js";
import { MarketService } from "./services.js";
import { sessionHours } from "./paper/market.js";
try {
  const mode = process.argv[2];
  if (mode === "execute") console.log(await executePaperDay(prisma));
  else if (mode === "report") {
    const config = paperConfig();
    if (!config.enabled) console.log({ status: "DISABLED" });
    else {
      const session = sessionDate(); const hours = await sessionHours(session);
      if (!hours) console.log({ status: "CLOSED" });
      else {
        if (Date.now() < Date.parse(hours.end)) throw new Error("Cannot collect closing marks before regular session ends");
        const service = new MarketService(prisma, new ProviderRegistry(), console);
        const date = new Date(`${session}T00:00:00Z`);
        for (const symbol of new Set([...config.symbols, config.benchmark])) await service.importHistory(symbol, date, date);
        const result = await reportPaperDay(prisma); console.log({ status: "REPORTED", id: "id" in result ? result.id : undefined });
      }
    }
  } else throw new Error("Usage: paper-job execute|report");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Paper job failed"); process.exitCode = 1;
} finally { await prisma.$disconnect(); }
