import { Command } from "commander";
import pino from "pino";
import { defaultPatternConfig, vixDefinition } from "./config.js";
import { prisma } from "./db.js";
import { ProviderRegistry } from "./providers/index.js";
import { instrumentInputSchema } from "./schemas.js";
import { MarketService } from "./services.js";
import { createDataCommand } from "./data-command.js";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info", transport: { target: "pino-pretty" } });
const service = new MarketService(prisma, new ProviderRegistry(), logger);
const program = new Command().name("regime").description("Market regime monitor CLI").version("0.1.0");
program.addCommand(createDataCommand(service));
program.command("seed").description("Add the default VIX instrument").action(async () => console.log(await service.addInstrument(vixDefinition)));
program.command("instrument:add").requiredOption("--symbol <symbol>").requiredOption("--name <name>").requiredOption("--provider-symbol <symbol>").option("--kind <kind>", "instrument kind", "INDEX").option("--provider <provider>", "provider name", "stooq").description("Add an instrument with the default pattern configuration").action(async (options) => console.log(await service.addInstrument(instrumentInputSchema.parse({ symbol: options.symbol, name: options.name, kind: options.kind, provider: options.provider, providerSymbol: options.providerSymbol, config: defaultPatternConfig }))));
program.command("instruments").action(async () => console.table(await prisma.instrument.findMany({ select: { symbol: true, name: true, provider: true, providerSymbol: true, active: true } })));
program.command("import").argument("<symbol>").option("--from <date>").option("--to <date>").action(async (symbol, options) => console.log({ imported: await service.importHistory(symbol, options.from ? new Date(options.from) : undefined, options.to ? new Date(options.to) : undefined) }));
program.command("analyze").argument("<symbol>").action(async (symbol) => console.dir(await service.analyze(symbol), { depth: null }));
program.command("backtest").argument("<symbol>").action(async (symbol) => console.table((await service.backtest(symbol)).byRegime));
program.command("alerts").option("--symbol <symbol>").option("--limit <number>", "maximum rows", "50").action(async (options) => console.table(await prisma.alert.findMany({ where: options.symbol ? { instrument: { symbol: options.symbol.toUpperCase() } } : {}, orderBy: { timestamp: "desc" }, take: Number(options.limit), select: { timestamp: true, severity: true, title: true, score: true, confidence: true } })));

// Some package runners forward their option separator to the script.
const args = process.argv.slice(2);
if (args[0] === "--") args.shift();
try {
  await program.parseAsync(args, { from: "user" });
} catch (error) {
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
