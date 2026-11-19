import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { PaperConfig } from "./config.js";
import type { Quote } from "./market.js";
const D = Prisma.Decimal;
export const positionsSchema = z.record(z.string(), z.object({ quantity: z.number().int().nonnegative(), costBasis: z.string() }).strict());
export const decisionSchema = z.object({
  action: z.enum(["HOLD", "REBALANCE"]), reason: z.string().min(1).max(4000),
  targets: z.array(z.object({ symbol: z.string(), weight: z.number().min(0).max(1) }).strict()).max(20),
}).strict();
export type Decision = z.infer<typeof decisionSchema>;
export function validateDecision(decision: Decision, config: PaperConfig): void {
  const symbols = decision.targets.map(t => t.symbol);
  if (decision.action === "HOLD") { if (symbols.length) throw new Error("HOLD must have no targets"); return; }
  if (symbols.length !== config.symbols.length || new Set(symbols).size !== symbols.length || symbols.some(s => !config.symbols.includes(s))) throw new Error("Decision must specify every configured target exactly once");
  if (decision.targets.some(t => t.weight > config.maxPositionWeight) || decision.targets.reduce((s, t) => s.plus(t.weight), new D(0)).gt(new D(1).minus(config.cashReserveWeight))) throw new Error("Decision allocation exceeds policy");
}
export function rebalance(cashValue: string, rawPositions: unknown, quotes: Record<string, Quote>, decision: Decision, config: PaperConfig) {
  validateDecision(decision, config);
  const positions = positionsSchema.parse(rawPositions);
  for (const [symbol, p] of Object.entries(positions)) {
    if (p.quantity && !config.symbols.includes(symbol)) throw new Error("Held symbol removed from policy; restore it before execution");
    if (!new D(p.costBasis).isFinite() || new D(p.costBasis).lt(0)) throw new Error("Invalid position cost basis");
  }
  let cash = new D(cashValue); let realized = new D(0); let turnover = new D(0);
  if (!cash.isFinite() || cash.lt(0)) throw new Error("Invalid cash balance");
  const mid = (s: string) => { const q = quotes[s]; if (!q) throw new Error("Missing valuation quote"); return new D(q.bid).plus(q.ask).div(2); };
  const equity = Object.entries(positions).reduce((sum, [s, p]) => p.quantity ? sum.plus(mid(s).mul(p.quantity)) : sum, cash);
  const fills: Array<{ symbol: string; side: "BUY" | "SELL"; quantity: number; price: string; fee: string }> = [];
  const fee = new D(config.feePerOrder);
  const targets = decision.targets
    .filter(target => !config.blockedSymbols?.includes(target.symbol))
    .map(target => ({ ...target, desired: equity.mul(target.weight).div(mid(target.symbol)).floor().toNumber() }));
  // Sells release cash before buys. Conservative bid/ask pricing includes adverse slippage.
  for (const side of ["SELL", "BUY"] as const) for (const target of targets) {
    const position = positions[target.symbol] ?? { quantity: 0, costBasis: "0" };
    const difference = target.desired - position.quantity;
    if ((side === "BUY" && difference <= 0) || (side === "SELL" && difference >= 0)) continue;
    const quote = quotes[target.symbol]!;
    const price = new D(side === "BUY" ? quote.ask : quote.bid).mul(new D(1).plus(new D(config.slippageBps).div(10000).mul(side === "BUY" ? 1 : -1))).toDecimalPlaces(4, side === "BUY" ? D.ROUND_UP : D.ROUND_DOWN);
    let quantity = Math.min(Math.abs(difference), new D(config.maxOrderDollars).div(price).floor().toNumber(), D.max(0, new D(config.maxDailyDollars).minus(turnover)).div(price).floor().toNumber());
    if (side === "BUY") {
      const currentEquity = Object.entries(positions).reduce((sum, [s, p]) => p.quantity ? sum.plus(mid(s).mul(p.quantity)) : sum, cash);
      const spreadCost = price.minus(mid(target.symbol));
      const reserve = new D(config.cashReserveWeight);
      const available = D.max(0, cash.minus(currentEquity.mul(reserve)).minus(fee.mul(new D(1).minus(reserve))));
      quantity = Math.min(quantity, available.div(price.minus(reserve.mul(spreadCost))).floor().toNumber());
      const weight = new D(config.maxPositionWeight);
      const capacity = D.max(0, currentEquity.minus(fee).mul(weight).minus(mid(target.symbol).mul(position.quantity)));
      quantity = Math.min(quantity, capacity.div(mid(target.symbol).plus(weight.mul(spreadCost))).floor().toNumber());
    } else if (cash.plus(price.mul(quantity)).lt(fee)) quantity = 0;
    if (quantity <= 0) continue;
    const notional = price.mul(quantity); turnover = turnover.plus(notional);
    const basis = new D(position.costBasis);
    if (side === "BUY") {
      cash = cash.minus(notional).minus(fee);
      position.costBasis = basis.plus(notional).plus(fee).toFixed(4);
      position.quantity += quantity;
    } else {
      const soldBasis = basis.mul(quantity).div(position.quantity);
      cash = cash.plus(notional).minus(fee); realized = realized.plus(notional.minus(fee).minus(soldBasis));
      position.quantity -= quantity; position.costBasis = position.quantity ? basis.minus(soldBasis).toFixed(4) : "0.0000";
    }
    positions[target.symbol] = position;
    fills.push({ symbol: target.symbol, side, quantity, price: price.toFixed(4), fee: fee.toFixed(4) });
  }
  return { cash: cash.toFixed(4), positions, fills, realizedPnl: realized.toFixed(4), turnover: turnover.toFixed(4), startingEquity: equity.toFixed(4) };
}
