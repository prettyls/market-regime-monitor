CREATE TABLE "PaperRuleReview" (
 "id" TEXT PRIMARY KEY, "accountId" TEXT NOT NULL, "session" TEXT NOT NULL,
 "ruleVersion" TEXT NOT NULL, "status" TEXT NOT NULL, "evidence" JSONB NOT NULL,
 "proposal" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "PaperRuleReview_accountId_session_ruleVersion_key" ON "PaperRuleReview"("accountId", "session", "ruleVersion");
