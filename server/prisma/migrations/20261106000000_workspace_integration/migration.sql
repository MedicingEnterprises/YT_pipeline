CREATE TABLE "WorkspaceImport" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "digest" CHAR(64) NOT NULL,
  "counts" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkspaceImport_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WorkspaceImport_userId_digest_key" ON "WorkspaceImport"("userId", "digest");
ALTER TABLE "WorkspaceImport" ADD CONSTRAINT "WorkspaceImport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
