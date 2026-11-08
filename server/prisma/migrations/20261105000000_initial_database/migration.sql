-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ChannelStatus" AS ENUM ('CONNECTED', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "ProviderCategory" AS ENUM ('TEXT_GENERATION', 'TEXT_TO_SPEECH', 'IMAGE_GENERATION', 'VIDEO_GENERATION', 'EMBEDDINGS_ANALYSIS');

-- CreateEnum
CREATE TYPE "ContentStatus" AS ENUM ('IDEA', 'SCRIPT', 'GENERATING', 'EDITING', 'READY', 'SCHEDULED', 'PUBLISHED', 'FAILED');

-- CreateEnum
CREATE TYPE "ContentFormat" AS ENUM ('LONG_FORM', 'SHORT', 'EXPLAINER', 'INTERVIEW');

-- CreateEnum
CREATE TYPE "Visibility" AS ENUM ('PUBLIC', 'PRIVATE', 'UNLISTED');

-- CreateEnum
CREATE TYPE "PublishPreference" AS ENUM ('DECIDE_LATER', 'MANUAL', 'SCHEDULE');

-- CreateEnum
CREATE TYPE "StepKind" AS ENUM ('IDEA', 'RESEARCH', 'SCRIPT', 'VOICE', 'VISUALS', 'EDIT', 'CAPTIONS', 'THUMBNAIL', 'QUALITY_CHECK', 'REVIEW', 'UPLOAD', 'SCHEDULE');

-- CreateEnum
CREATE TYPE "ScheduleStatus" AS ENUM ('SCHEDULED', 'READY', 'PROCESSING', 'NEEDS_ATTENTION');

-- CreateEnum
CREATE TYPE "ExecutionMode" AS ENUM ('PIPELINE', 'PUBLICATION');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('PIPELINE_EXECUTION', 'SCHEDULED_PUBLICATION', 'RETRY');

-- CreateEnum
CREATE TYPE "JobKind" AS ENUM ('IDEA_GENERATION', 'SCRIPT_GENERATION', 'VOICE_GENERATION', 'VISUAL_GENERATION', 'VIDEO_EDITING', 'CAPTION_GENERATION', 'THUMBNAIL_GENERATION', 'QUALITY_CHECK', 'UPLOAD', 'SCHEDULING');

-- CreateEnum
CREATE TYPE "ActivityCategory" AS ENUM ('UPLOAD', 'GENERATION', 'SCHEDULING', 'WARNING', 'FAILURE', 'SUCCESS');

-- CreateEnum
CREATE TYPE "Appearance" AS ENUM ('LIGHT', 'DARK', 'SYSTEM');

-- CreateEnum
CREATE TYPE "WeeklyDigest" AS ENUM ('NEVER', 'MONDAY', 'FRIDAY');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "displayName" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Channel" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "handle" VARCHAR(100) NOT NULL,
    "category" TEXT NOT NULL DEFAULT '',
    "color" TEXT NOT NULL DEFAULT 'channel-purple',
    "status" "ChannelStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "subscriberCount" BIGINT NOT NULL DEFAULT 0,
    "scheduleDays" TEXT NOT NULL DEFAULT '',
    "scheduleTime" VARCHAR(5) NOT NULL DEFAULT '09:00',
    "defaultPipelineId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIProvider" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "category" "ProviderCategory" NOT NULL,
    "connected" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "models" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastUsedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AIProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pipeline" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Pipeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineChannel" (
    "userId" UUID NOT NULL,
    "pipelineId" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PipelineChannel_pkey" PRIMARY KEY ("userId","pipelineId","channelId")
);

-- CreateTable
CREATE TABLE "PipelineStep" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "pipelineId" UUID NOT NULL,
    "providerId" UUID,
    "kind" "StepKind" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL,
    "instructions" TEXT NOT NULL DEFAULT '',
    "durationMs" INTEGER NOT NULL DEFAULT 1000,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PipelineStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentItem" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "pipelineId" UUID,
    "title" VARCHAR(300) NOT NULL,
    "status" "ContentStatus" NOT NULL DEFAULT 'IDEA',
    "format" "ContentFormat" NOT NULL DEFAULT 'LONG_FORM',
    "visibility" "Visibility" NOT NULL DEFAULT 'PRIVATE',
    "publishPreference" "PublishPreference" NOT NULL DEFAULT 'DECIDE_LATER',
    "notes" TEXT NOT NULL DEFAULT '',
    "thumbnail" TEXT NOT NULL DEFAULT '',
    "publishedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ContentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Schedule" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "contentId" UUID NOT NULL,
    "scheduledAt" TIMESTAMPTZ(3) NOT NULL,
    "timezone" VARCHAR(100) NOT NULL DEFAULT 'UTC',
    "status" "ScheduleStatus" NOT NULL DEFAULT 'SCHEDULED',
    "executionMode" "ExecutionMode" NOT NULL DEFAULT 'PUBLICATION',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "contentId" UUID NOT NULL,
    "pipelineId" UUID,
    "pipelineStepId" UUID,
    "providerId" UUID,
    "scheduleId" UUID,
    "type" "JobType" NOT NULL DEFAULT 'PIPELINE_EXECUTION',
    "kind" "JobKind" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "mode" "ExecutionMode" NOT NULL DEFAULT 'PIPELINE',
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "claimed" BOOLEAN NOT NULL DEFAULT false,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" VARCHAR(300),
    "scheduledAt" TIMESTAMPTZ(3),
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "errorMessage" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "execution" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobEvent" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "status" "JobStatus" NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "contentId" UUID,
    "channelId" UUID,
    "pipelineId" UUID,
    "providerId" UUID,
    "jobId" UUID,
    "category" "ActivityCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "icon" TEXT NOT NULL DEFAULT 'Activity',
    "tone" TEXT NOT NULL DEFAULT 'activity-blue',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsRecord" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "contentId" UUID NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "views" BIGINT NOT NULL DEFAULT 0,
    "watchTimeHours" DECIMAL(16,4) NOT NULL DEFAULT 0,
    "averageDurationSeconds" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "engagementRate" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "subscribersGained" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AnalyticsRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPreferences" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "workspaceName" TEXT NOT NULL DEFAULT 'My workspace',
    "timezone" VARCHAR(100) NOT NULL DEFAULT 'UTC',
    "language" TEXT NOT NULL DEFAULT 'en',
    "appearance" "Appearance" NOT NULL DEFAULT 'SYSTEM',
    "compactDensity" BOOLEAN NOT NULL DEFAULT false,
    "reducedMotion" BOOLEAN NOT NULL DEFAULT false,
    "notifyPipeline" BOOLEAN NOT NULL DEFAULT true,
    "notifyPublishing" BOOLEAN NOT NULL DEFAULT true,
    "notifyWarnings" BOOLEAN NOT NULL DEFAULT true,
    "weeklyDigest" "WeeklyDigest" NOT NULL DEFAULT 'NEVER',
    "defaultChannelId" UUID,
    "defaultPipelineId" UUID,
    "textProviderId" UUID,
    "voiceProviderId" UUID,
    "imageProviderId" UUID,
    "defaultVisibility" "Visibility" NOT NULL DEFAULT 'PRIVATE',
    "defaultPublishTime" VARCHAR(5) NOT NULL DEFAULT '09:00',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "UserPreferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Channel_userId_status_idx" ON "Channel"("userId", "status");

-- CreateIndex
CREATE INDEX "Channel_userId_defaultPipelineId_idx" ON "Channel"("userId", "defaultPipelineId");

-- CreateIndex
CREATE UNIQUE INDEX "Channel_userId_id_key" ON "Channel"("userId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Channel_userId_handle_key" ON "Channel"("userId", "handle");

-- CreateIndex
CREATE INDEX "AIProvider_userId_category_enabled_idx" ON "AIProvider"("userId", "category", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "AIProvider_userId_id_key" ON "AIProvider"("userId", "id");

-- CreateIndex
CREATE INDEX "Pipeline_userId_enabled_idx" ON "Pipeline"("userId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "Pipeline_userId_id_key" ON "Pipeline"("userId", "id");

-- CreateIndex
CREATE INDEX "PipelineChannel_userId_channelId_idx" ON "PipelineChannel"("userId", "channelId");

-- CreateIndex
CREATE INDEX "PipelineStep_userId_providerId_idx" ON "PipelineStep"("userId", "providerId");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineStep_userId_id_key" ON "PipelineStep"("userId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineStep_userId_pipelineId_order_key" ON "PipelineStep"("userId", "pipelineId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineStep_userId_pipelineId_id_key" ON "PipelineStep"("userId", "pipelineId", "id");

-- CreateIndex
CREATE INDEX "ContentItem_userId_status_createdAt_idx" ON "ContentItem"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ContentItem_userId_channelId_status_idx" ON "ContentItem"("userId", "channelId", "status");

-- CreateIndex
CREATE INDEX "ContentItem_userId_pipelineId_idx" ON "ContentItem"("userId", "pipelineId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentItem_userId_id_key" ON "ContentItem"("userId", "id");

-- CreateIndex
CREATE INDEX "Schedule_status_scheduledAt_idx" ON "Schedule"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "Schedule_userId_scheduledAt_idx" ON "Schedule"("userId", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "Schedule_userId_id_key" ON "Schedule"("userId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Schedule_userId_contentId_key" ON "Schedule"("userId", "contentId");

-- CreateIndex
CREATE UNIQUE INDEX "Schedule_userId_contentId_id_key" ON "Schedule"("userId", "contentId", "id");

-- CreateIndex
CREATE INDEX "Job_status_scheduledAt_idx" ON "Job"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "Job_userId_contentId_createdAt_idx" ON "Job"("userId", "contentId", "createdAt");

-- CreateIndex
CREATE INDEX "Job_userId_pipelineId_pipelineStepId_idx" ON "Job"("userId", "pipelineId", "pipelineStepId");

-- CreateIndex
CREATE INDEX "Job_userId_providerId_idx" ON "Job"("userId", "providerId");

-- CreateIndex
CREATE INDEX "Job_userId_contentId_scheduleId_idx" ON "Job"("userId", "contentId", "scheduleId");

-- CreateIndex
CREATE UNIQUE INDEX "Job_userId_id_key" ON "Job"("userId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Job_userId_idempotencyKey_key" ON "Job"("userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "JobEvent_userId_jobId_createdAt_idx" ON "JobEvent"("userId", "jobId", "createdAt");

-- CreateIndex
CREATE INDEX "Activity_userId_createdAt_idx" ON "Activity"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Activity_userId_contentId_idx" ON "Activity"("userId", "contentId");

-- CreateIndex
CREATE INDEX "Activity_userId_channelId_idx" ON "Activity"("userId", "channelId");

-- CreateIndex
CREATE INDEX "Activity_userId_pipelineId_idx" ON "Activity"("userId", "pipelineId");

-- CreateIndex
CREATE INDEX "Activity_userId_providerId_idx" ON "Activity"("userId", "providerId");

-- CreateIndex
CREATE INDEX "Activity_userId_jobId_idx" ON "Activity"("userId", "jobId");

-- CreateIndex
CREATE INDEX "AnalyticsRecord_userId_recordedAt_idx" ON "AnalyticsRecord"("userId", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsRecord_userId_contentId_recordedAt_key" ON "AnalyticsRecord"("userId", "contentId", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserPreferences_userId_key" ON "UserPreferences"("userId");

-- CreateIndex
CREATE INDEX "UserPreferences_userId_defaultChannelId_idx" ON "UserPreferences"("userId", "defaultChannelId");

-- CreateIndex
CREATE INDEX "UserPreferences_userId_defaultPipelineId_idx" ON "UserPreferences"("userId", "defaultPipelineId");

-- CreateIndex
CREATE INDEX "UserPreferences_userId_textProviderId_idx" ON "UserPreferences"("userId", "textProviderId");

-- CreateIndex
CREATE INDEX "UserPreferences_userId_voiceProviderId_idx" ON "UserPreferences"("userId", "voiceProviderId");

-- CreateIndex
CREATE INDEX "UserPreferences_userId_imageProviderId_idx" ON "UserPreferences"("userId", "imageProviderId");

-- AddForeignKey
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_userId_defaultPipelineId_fkey" FOREIGN KEY ("userId", "defaultPipelineId") REFERENCES "Pipeline"("userId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AIProvider" ADD CONSTRAINT "AIProvider_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pipeline" ADD CONSTRAINT "Pipeline_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineChannel" ADD CONSTRAINT "PipelineChannel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineChannel" ADD CONSTRAINT "PipelineChannel_userId_pipelineId_fkey" FOREIGN KEY ("userId", "pipelineId") REFERENCES "Pipeline"("userId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PipelineChannel" ADD CONSTRAINT "PipelineChannel_userId_channelId_fkey" FOREIGN KEY ("userId", "channelId") REFERENCES "Channel"("userId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PipelineStep" ADD CONSTRAINT "PipelineStep_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineStep" ADD CONSTRAINT "PipelineStep_userId_pipelineId_fkey" FOREIGN KEY ("userId", "pipelineId") REFERENCES "Pipeline"("userId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PipelineStep" ADD CONSTRAINT "PipelineStep_userId_providerId_fkey" FOREIGN KEY ("userId", "providerId") REFERENCES "AIProvider"("userId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_userId_channelId_fkey" FOREIGN KEY ("userId", "channelId") REFERENCES "Channel"("userId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_userId_pipelineId_fkey" FOREIGN KEY ("userId", "pipelineId") REFERENCES "Pipeline"("userId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_userId_contentId_fkey" FOREIGN KEY ("userId", "contentId") REFERENCES "ContentItem"("userId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_userId_contentId_fkey" FOREIGN KEY ("userId", "contentId") REFERENCES "ContentItem"("userId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_userId_pipelineId_fkey" FOREIGN KEY ("userId", "pipelineId") REFERENCES "Pipeline"("userId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_userId_pipelineId_pipelineStepId_fkey" FOREIGN KEY ("userId", "pipelineId", "pipelineStepId") REFERENCES "PipelineStep"("userId", "pipelineId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_userId_providerId_fkey" FOREIGN KEY ("userId", "providerId") REFERENCES "AIProvider"("userId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_userId_contentId_scheduleId_fkey" FOREIGN KEY ("userId", "contentId", "scheduleId") REFERENCES "Schedule"("userId", "contentId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "JobEvent" ADD CONSTRAINT "JobEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobEvent" ADD CONSTRAINT "JobEvent_userId_jobId_fkey" FOREIGN KEY ("userId", "jobId") REFERENCES "Job"("userId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_userId_contentId_fkey" FOREIGN KEY ("userId", "contentId") REFERENCES "ContentItem"("userId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_userId_channelId_fkey" FOREIGN KEY ("userId", "channelId") REFERENCES "Channel"("userId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_userId_pipelineId_fkey" FOREIGN KEY ("userId", "pipelineId") REFERENCES "Pipeline"("userId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_userId_providerId_fkey" FOREIGN KEY ("userId", "providerId") REFERENCES "AIProvider"("userId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_userId_jobId_fkey" FOREIGN KEY ("userId", "jobId") REFERENCES "Job"("userId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AnalyticsRecord" ADD CONSTRAINT "AnalyticsRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsRecord" ADD CONSTRAINT "AnalyticsRecord_userId_contentId_fkey" FOREIGN KEY ("userId", "contentId") REFERENCES "ContentItem"("userId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "UserPreferences" ADD CONSTRAINT "UserPreferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPreferences" ADD CONSTRAINT "UserPreferences_userId_defaultChannelId_fkey" FOREIGN KEY ("userId", "defaultChannelId") REFERENCES "Channel"("userId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "UserPreferences" ADD CONSTRAINT "UserPreferences_userId_defaultPipelineId_fkey" FOREIGN KEY ("userId", "defaultPipelineId") REFERENCES "Pipeline"("userId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "UserPreferences" ADD CONSTRAINT "UserPreferences_userId_textProviderId_fkey" FOREIGN KEY ("userId", "textProviderId") REFERENCES "AIProvider"("userId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "UserPreferences" ADD CONSTRAINT "UserPreferences_userId_voiceProviderId_fkey" FOREIGN KEY ("userId", "voiceProviderId") REFERENCES "AIProvider"("userId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "UserPreferences" ADD CONSTRAINT "UserPreferences_userId_imageProviderId_fkey" FOREIGN KEY ("userId", "imageProviderId") REFERENCES "AIProvider"("userId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- Custom invariants not expressible in Prisma. Preserve in future migrations.
CREATE UNIQUE INDEX "Job_one_active_content" ON "Job" ("userId", "contentId") WHERE "status" IN ('QUEUED', 'PROCESSING');
CREATE UNIQUE INDEX "User_email_case_insensitive" ON "User" (lower("email"));
CREATE UNIQUE INDEX "Channel_handle_case_insensitive" ON "Channel" ("userId", lower("handle"));
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_subscriberCount_check" CHECK ("subscriberCount" >= 0);
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_scheduleTime_check" CHECK ("scheduleTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
ALTER TABLE "PipelineStep" ADD CONSTRAINT "PipelineStep_order_duration_check" CHECK ("order" >= 0 AND "durationMs" >= 0);
ALTER TABLE "Job" ADD CONSTRAINT "Job_progress_attempt_check" CHECK ("progress" BETWEEN 0 AND 100 AND "attempt" >= 1);
ALTER TABLE "Job" ADD CONSTRAINT "Job_step_pipeline_check" CHECK ("pipelineStepId" IS NULL OR "pipelineId" IS NOT NULL);
ALTER TABLE "Job" ADD CONSTRAINT "Job_completion_check" CHECK (
  ("status" IN ('COMPLETED', 'FAILED', 'CANCELLED')) = ("completedAt" IS NOT NULL)
  AND ("completedAt" IS NULL OR "startedAt" IS NULL OR "completedAt" >= "startedAt")
  AND (NOT "paused" OR "status" IN ('QUEUED', 'PROCESSING'))
);
ALTER TABLE "JobEvent" ADD CONSTRAINT "JobEvent_attempt_check" CHECK ("attempt" >= 1);
ALTER TABLE "AnalyticsRecord" ADD CONSTRAINT "AnalyticsRecord_metrics_check" CHECK ("views" >= 0 AND "watchTimeHours" >= 0 AND "averageDurationSeconds" >= 0 AND "engagementRate" BETWEEN 0 AND 100);
ALTER TABLE "UserPreferences" ADD CONSTRAINT "UserPreferences_publishTime_check" CHECK ("defaultPublishTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
