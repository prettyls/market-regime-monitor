CREATE TABLE "SchwabCalendarTransaction" (
    "accountKey" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "time" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,
    CONSTRAINT "SchwabCalendarTransaction_pkey" PRIMARY KEY ("accountKey", "activityId")
);
CREATE INDEX "SchwabCalendarTransaction_accountKey_time_idx" ON "SchwabCalendarTransaction"("accountKey", "time");

CREATE TABLE "SchwabCalendarSnapshot" (
    "key" TEXT NOT NULL,
    "accountKey" TEXT NOT NULL,
    "historyStart" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "days" JSONB NOT NULL,
    CONSTRAINT "SchwabCalendarSnapshot_pkey" PRIMARY KEY ("key")
);
