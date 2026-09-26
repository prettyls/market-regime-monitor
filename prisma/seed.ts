import { vixDefinition } from "../src/config.js";
import { prisma } from "../src/db.js";
import { ProviderRegistry } from "../src/providers/index.js";
import { MarketService } from "../src/services.js";
import pino from "pino";
await new MarketService(prisma, new ProviderRegistry(), pino()).addInstrument(vixDefinition);
await prisma.$disconnect();
