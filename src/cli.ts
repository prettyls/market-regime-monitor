import { Command } from "commander";
import { defaultPatternConfig, vixDefinition } from "./config.js";
import { prisma } from "./db.js";
import { instrumentInputSchema } from "./schemas.js";
import { runCommand, service } from "./command-runtime.js";
import { createDataCommand } from "./data-command.js";

const program = new Command().name("regime").description("Market regime monitor CLI").version("0.1.0");
program.addCommand(createDataCommand(service));
program.command("seed").description("Add the default VIX instrument").action(async () => console.log(await service.addInstrument(vixDefinition)));
program.command("instrument:add").requiredOption("--symbol <symbol>").requiredOption("--name <name>").requiredOption("--provider-symbol <symbol>").option("--kind <kind>", "instrument kind", "INDEX").option("--provider <provider>", "provider name", "stooq").description("Add an instrument with the default pattern configuration").action(async (options) => console.log(await service.addInstrument(instrumentInputSchema.parse({ symbol: options.symbol, name: options.name, kind: options.kind, provider: options.provider, providerSymbol: options.providerSymbol, config: defaultPatternConfig }))));
program.command("instruments").action(async () => console.table(await prisma.instrument.findMany({ select: { symbol: true, name: true, provider: true, providerSymbol: true, active: true } })));
program.command("import").argument("<symbol>").option("--from <date>").option("--to <date>").action(async (symbol, options) => console.log({ imported: await service.importHistory(symbol, options.from ? new Date(options.from) : undefined, options.to ? new Date(options.to) : undefined) }));
program.command("analyze").argument("<symbol>").action(async (symbol) => console.dir(await service.analyze(symbol), { depth: null }));
program.command("backtest").argument("<symbol>").action(async (symbol) => console.table((await service.backtest(symbol)).byRegime));
program.command("alerts").option("--symbol <symbol>").option("--limit <number>", "maximum rows", "50").action(async (options) => console.table(await prisma.alert.findMany({ where: options.symbol ? { instrument: { symbol: options.symbol.toUpperCase() } } : {}, orderBy: { timestamp: "desc" }, take: Number(options.limit), select: { timestamp: true, severity: true, title: true, score: true, confidence: true } })));

await runCommand(program);
