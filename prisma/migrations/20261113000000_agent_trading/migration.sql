CREATE TABLE "TradeProposal" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "agentId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "limitPrice" DECIMAL(18,4) NOT NULL,
  "snapshot" JSONB NOT NULL,
  "policy" JSONB NOT NULL,
  "request" JSONB NOT NULL,
  "simulation" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "TradeProposal_agentId_idempotencyKey_key" ON "TradeProposal"("agentId", "idempotencyKey");
CREATE INDEX "TradeProposal_createdAt_idx" ON "TradeProposal"("createdAt");
CREATE TABLE "TradingAuditEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "agentId" TEXT NOT NULL,
  "proposalId" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "details" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "TradingAuditEvent_proposalId_createdAt_idx" ON "TradingAuditEvent"("proposalId", "createdAt");
