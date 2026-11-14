import { runCommand, service } from "./command-runtime.js";
import { prisma } from "./db.js";
import { createJobCommand } from "./job-command.js";
import { planPaperDay, previousSession } from "./paper/service.js";
import { paperConfig, sessionDate } from "./paper/config.js";
import { sessionHours } from "./paper/market.js";
try {
  const enabled = paperConfig().enabled;
  if (enabled && !await sessionHours(sessionDate())) {
    console.log({ status: "CLOSED" }); await prisma.$disconnect();
  } else {
    await runCommand(createJobCommand("collect", service, async () =>
      (await prisma.instrument.findMany({ where: { active: true }, orderBy: { symbol: "asc" }, select: { symbol: true } })).map(r => r.symbol),
      console, async results => { console.log(await planPaperDay(prisma, results)); },
      enabled ? async () => new Date(`${await previousSession(sessionDate())}T00:00:00Z`) : undefined
    ));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Daily paper workflow failed");
  process.exitCode = 1; await prisma.$disconnect();
}
