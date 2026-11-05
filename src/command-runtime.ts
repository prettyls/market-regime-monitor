import "dotenv/config";
import { Command, CommanderError } from "commander";
import pino from "pino";
import { prisma } from "./db.js";
import { ProviderRegistry } from "./providers/index.js";
import { MarketService } from "./services.js";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info", ...(process.env.NODE_ENV === "production" ? {} : { transport: { target: "pino-pretty" } }) });
export const service = new MarketService(prisma, new ProviderRegistry(), logger);

export async function runCommand(program: Command): Promise<void> {
  // Some package runners forward their option separator to the script.
  const args = process.argv.slice(2);
  if (args[0] === "--") args.shift();
  program.exitOverride();
  try {
    await program.parseAsync(args, { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError) {
      process.exitCode = error.exitCode;
    } else {
      console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}
