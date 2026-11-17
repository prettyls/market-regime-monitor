import { z } from "zod";
import rawRules from "./trading-rules.json" with { type: "json" };
import type { PaperConfig } from "./config.js";
import type { Decision } from "./engine.js";
export const tradingRulesSchema = z.object({
  version: z.string().min(1), description: z.string().min(1),
  entryRegimes: z.array(z.enum(["BREAKOUT_UP", "TREND_UP"])).min(1),
  minimumScore: z.number().min(0).max(100), minimumConfidence: z.number().min(0).max(100),
  exitRegimes: z.array(z.enum(["BREAKOUT_DOWN", "TREND_DOWN"])).min(1),
  otherRegimeAction: z.literal("NO_NEW_ALLOCATION"), requireExitOnBearishSignal: z.boolean(),
}).strict();
export const tradingRules = tradingRulesSchema.parse(rawRules);
const snapshotSchema = z.array(z.object({
  instrument: z.object({ symbol: z.string() }),
  analysis: z.object({ regime: z.string(), score: z.number().finite(), confidence: z.number().finite() }),
  referenceClose: z.number().positive().finite(),
}));
const accountSchema = z.object({ cash: z.coerce.number().nonnegative().finite(), positions: z.record(z.string(), z.object({ quantity: z.number().int().nonnegative() })) });
/** Validate strategy constraints separately from order/cash/exposure policy. */
export function validateTradingRules(decision: Decision, config: PaperConfig, snapshots: unknown, rawAccount: unknown) {
  const rows = snapshotSchema.parse(snapshots); const account = accountSchema.parse(rawAccount);
  const map = new Map(rows.map(r => [r.instrument.symbol, r]));
  let equity = account.cash;
  for (const [symbol, p] of Object.entries(account.positions)) if (p.quantity) {
    const row = map.get(symbol); if (!row) throw new Error("Missing held-instrument analysis for trading rules");
    equity += p.quantity * row.referenceClose;
  }
  for (const symbol of config.symbols) {
    const row = map.get(symbol); if (!row) throw new Error("Missing target analysis for trading rules");
    const qty = account.positions[symbol]?.quantity ?? 0;
    const bearish = tradingRules.exitRegimes.some(r => r === row.analysis.regime);
    const target = decision.targets.find(t => t.symbol === symbol);
    if (bearish && tradingRules.requireExitOnBearishSignal && qty > 0 && (decision.action === "HOLD" || !target || target.weight !== 0)) throw new Error("Trading rules require a zero target for bearish holdings");
    const qualified = tradingRules.entryRegimes.some(r => r === row.analysis.regime) && row.analysis.score >= tradingRules.minimumScore && row.analysis.confidence >= tradingRules.minimumConfidence;
    if (decision.action === "REBALANCE" && !qualified && target) {
      const currentWeight = equity ? qty * row.referenceClose / equity : 0;
      if (target.weight > currentWeight + 1e-10) throw new Error("Trading rules prohibit increasing allocation without a qualified bullish signal");
    }
  }
}
