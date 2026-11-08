CREATE TYPE "AIRequestStatus" AS ENUM ('PROCESSING', 'SUCCEEDED', 'FAILED', 'UNKNOWN');
CREATE TABLE "AIUsage" (
 "id" UUID NOT NULL PRIMARY KEY,
 "userId" UUID NOT NULL,
 "requestId" UUID NOT NULL,
 "providerId" UUID NOT NULL,
 "adapterId" VARCHAR(40) NOT NULL,
 "model" VARCHAR(100) NOT NULL,
 "status" "AIRequestStatus" NOT NULL DEFAULT 'PROCESSING',
 "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "completedAt" TIMESTAMPTZ(3),
 "inputTokens" INTEGER, "outputTokens" INTEGER, "cacheReadTokens" INTEGER, "cacheWriteTokens" INTEGER,
 "estimatedCostUsd" DECIMAL(18,8), "errorCode" VARCHAR(80),
 CONSTRAINT "AIUsage_user_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "AIUsage_tokens_check" CHECK (("inputTokens" IS NULL OR "inputTokens" >= 0) AND ("outputTokens" IS NULL OR "outputTokens" >= 0) AND ("cacheReadTokens" IS NULL OR "cacheReadTokens" >= 0) AND ("cacheWriteTokens" IS NULL OR "cacheWriteTokens" >= 0)),
 CONSTRAINT "AIUsage_cost_check" CHECK ("estimatedCostUsd" IS NULL OR "estimatedCostUsd" >= 0),
 CONSTRAINT "AIUsage_completion_check" CHECK (("status" = 'PROCESSING' AND "completedAt" IS NULL) OR ("status" <> 'PROCESSING' AND "completedAt" IS NOT NULL AND "completedAt" >= "requestedAt"))
);
CREATE UNIQUE INDEX "AIUsage_userId_requestId_key" ON "AIUsage"("userId", "requestId");
CREATE INDEX "AIUsage_userId_requestedAt_idx" ON "AIUsage"("userId", "requestedAt");
