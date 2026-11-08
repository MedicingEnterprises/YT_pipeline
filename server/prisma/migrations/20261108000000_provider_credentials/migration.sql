ALTER TABLE "AIProvider" ADD COLUMN "adapterId" VARCHAR(40) NOT NULL DEFAULT 'mock';
CREATE TABLE "ProviderCredential" (
 "providerId" UUID NOT NULL PRIMARY KEY,
 "userId" UUID NOT NULL,
 "envelope" TEXT NOT NULL,
 "updatedAt" TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT "ProviderCredential_provider_fkey" FOREIGN KEY ("userId", "providerId") REFERENCES "AIProvider"("userId", "id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE INDEX "ProviderCredential_userId_idx" ON "ProviderCredential"("userId");
CREATE UNIQUE INDEX "ProviderCredential_userId_providerId_key" ON "ProviderCredential"("userId", "providerId");
