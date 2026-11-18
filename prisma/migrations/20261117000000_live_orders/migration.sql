CREATE TABLE "LiveOrder" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "request" JSONB NOT NULL,
    "notional" DECIMAL(18,4) NOT NULL,
    "brokerOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LiveOrder_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LiveOrder_agentId_idempotencyKey_key" ON "LiveOrder"("agentId", "idempotencyKey");
CREATE INDEX "LiveOrder_createdAt_idx" ON "LiveOrder"("createdAt");
