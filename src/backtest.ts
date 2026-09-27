import { runCommand, service } from "./command-runtime.js";
import { prisma } from "./db.js";
import { createJobCommand } from "./job-command.js";

await runCommand(createJobCommand("backtest", service, async () =>
  (await prisma.instrument.findMany({ where: { active: true }, orderBy: { symbol: "asc" }, select: { symbol: true } })).map((row) => row.symbol)
));
