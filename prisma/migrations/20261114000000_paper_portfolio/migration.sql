CREATE TABLE "PaperAccount" (
 "id" TEXT PRIMARY KEY, "initialCash" DECIMAL(18,4) NOT NULL,
 "cash" DECIMAL(18,4) NOT NULL, "positions" JSONB NOT NULL,
 "benchmark" TEXT NOT NULL, "benchmarkStartPrice" DECIMAL(18,4),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "PaperRun" (
 "id" TEXT PRIMARY KEY, "accountId" TEXT NOT NULL, "session" TEXT NOT NULL,
 "strategy" TEXT NOT NULL, "status" TEXT NOT NULL, "inputs" JSONB NOT NULL,
 "decision" JSONB NOT NULL, "execution" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "PaperRun_accountId_session_strategy_key" ON "PaperRun"("accountId","session","strategy");
CREATE UNIQUE INDEX "PaperRun_accountId_session_key" ON "PaperRun"("accountId","session");
CREATE TABLE "PaperFill" (
 "id" TEXT PRIMARY KEY, "runId" TEXT NOT NULL, "symbol" TEXT NOT NULL,
 "side" TEXT NOT NULL, "quantity" INTEGER NOT NULL, "price" DECIMAL(18,4) NOT NULL,
 "fee" DECIMAL(18,4) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "PaperFill_runId_symbol_key" ON "PaperFill"("runId","symbol");
CREATE TABLE "PaperReport" (
 "id" TEXT PRIMARY KEY, "accountId" TEXT NOT NULL, "session" TEXT NOT NULL,
 "metrics" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "PaperReport_accountId_session_key" ON "PaperReport"("accountId","session");
