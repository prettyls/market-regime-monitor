CREATE TABLE "SchwabTradeToken" (
    "id" TEXT NOT NULL,
    "seedHash" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SchwabTradeToken_pkey" PRIMARY KEY ("id")
);
