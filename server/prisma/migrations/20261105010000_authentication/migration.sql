-- Passwordless legacy/demo users remain non-authenticatable until a separate
-- future verified enrollment flow exists. Never add a seeded password.
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;
ALTER TABLE "User" ADD CONSTRAINT "User_passwordHash_check" CHECK (
  "passwordHash" IS NULL OR "passwordHash" ~ '^scrypt\$131072\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{128}$'
);

CREATE TABLE "Session" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "tokenHash" CHAR(64) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "idleExpiresAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "Session_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Session_expiration_check" CHECK ("expiresAt" > "createdAt" AND "idleExpiresAt" <= "expiresAt"),
  CONSTRAINT "Session_token_hash_check" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");
CREATE INDEX "Session_idleExpiresAt_idx" ON "Session"("idleExpiresAt");
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
