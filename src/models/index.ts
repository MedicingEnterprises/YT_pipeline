/**
 * Domain models for the YouTube automation application.
 * These are strongly typed entities that represent the core business objects.
 */

// ============================================================================
// CHANNEL MODEL
// ============================================================================

export type ChannelStatus = 'connected' | 'disconnected'

export type ChannelColor = 'channel-purple' | 'channel-green' | 'channel-orange' | 'channel-blue'

export interface Channel {
  id: string
  name: string
  handle: string
  category: string
  subscribers: string
  videos: string
  initials: string
  color: ChannelColor
  status: ChannelStatus
  recentActivity: string
  activityTime: string
  scheduleDays: string
  scheduleTime: string
  scheduledCount: number
  publishedCount: number
  defaultPipelineId: string | null
  recentUploads: ChannelUpload[]
  createdAt: string
  updatedAt: string
}

export interface ChannelUpload {
  id: string
  title: string
  status: string
  date: string
  tone: 'green' | 'blue' | 'amber'
}

// ============================================================================
// AI PROVIDER MODEL
// ============================================================================

export type ProviderCategory = 
  | 'Text generation'
  | 'Text-to-speech'
  | 'Image generation'
  | 'Video generation'
  | 'Embeddings / analysis'

export interface AIProvider {
  id: string
  name: string
  category: ProviderCategory
  connected: boolean
  enabled: boolean
  models: string[]
  lastUsed: string
  createdAt: string
  updatedAt: string
}

// ============================================================================
// CONTENT/VIDEO MODEL
// ============================================================================

export type ContentStatus = 
  | 'Idea'
  | 'Script'
  | 'Generating'
  | 'Editing'
  | 'Ready'
  | 'Scheduled'
  | 'Published'
  | 'Failed'

export type ContentFormat = 
  | 'Long-form video'
  | 'YouTube Short'
  | 'Explainer'
  | 'Interview'

export type PublishPreference = 
  | 'Decide later'
  | 'Publish manually when ready'
  | 'Schedule for a date'

export interface ContentItem {
  publishedAt?: string | null
  visibility?: 'public' | 'private' | 'unlisted'
  id: string
  title: string
  channelId: string
  pipelineId: string
  status: ContentStatus
  createdAt: string
  scheduledAt: string
  format: ContentFormat
  publishPreference: PublishPreference
  notes: string
  thumbnail: string
  updatedAt: string
}

// ============================================================================
// PIPELINE MODEL
// ============================================================================

export type PipelineStepKind = 
  | 'Idea'
  | 'Script'
  | 'Voice'
  | 'Visuals'
  | 'Edit'
  | 'Captions'
  | 'Thumbnail'
  | 'Quality check'
  | 'Upload'
  | 'Schedule'
  | 'Research'
  | 'Review'

export interface PipelineStepConfig {
  instructions: string
  providerId: string | null
}

export interface PipelineStep {
  id: string
  kind: PipelineStepKind
  enabled: boolean
  config: PipelineStepConfig
  order: number
}

export interface Pipeline {
  id: string
  name: string
  description: string
  assignedChannelIds: string[]
  enabled: boolean
  lastUsed: string
  steps: PipelineStep[]
  createdAt: string
  updatedAt: string
}

// ============================================================================
// SCHEDULE MODEL
// ============================================================================

export type ScheduleStatus = 
  | 'Scheduled'
  | 'Ready'
  | 'Processing'
  | 'Needs attention'

export interface ScheduledVideo {
  executionMode?: 'pipeline' | 'publication'
  id: string
  contentId: string
  title: string
  thumbnail: string
  channelId: string
  pipelineId: string
  scheduledAt: string
  status: ScheduleStatus
  createdAt: string
  updatedAt: string
}

// ============================================================================
// JOB MODEL
// ============================================================================

export type JobStatus = 
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type JobKind = 
  | 'idea_generation'
  | 'script_generation'
  | 'voice_generation'
  | 'visual_generation'
  | 'video_editing'
  | 'caption_generation'
  | 'thumbnail_generation'
  | 'quality_check'
  | 'upload'
  | 'scheduling'

export interface Job {
  paused?: boolean
  id: string
  contentId: string
  pipelineStepId: string
  kind: JobKind
  status: JobStatus
  providerId: string | null
  startedAt: string | null
  completedAt: string | null
  errorMessage: string | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
  execution?: PipelineExecution
  queue?: QueueJob
}

export interface QueueJob {
  timezone: string
  type: 'PIPELINE_EXECUTION' | 'SCHEDULED_PUBLICATION' | 'RETRY'
  mode: 'pipeline' | 'publication'
  scheduleId: string | null
  scheduleKey: string | null
  scheduledAt: string | null
  pipelineId: string
  claimed: boolean
  attempt: number
  history: { status: JobStatus; at: string; message: string; attempt: number }[]
}

export type ExecutionStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'

export interface ExecutionStep {
  id: string
  kind: PipelineStepKind
  providerId: string | null
  instructions: string
  durationMs: number
}

/** Durable worker checkpoint. Timers and React state are deliberately excluded. */
export interface PipelineExecution {
  reviewBeforePublishing?: boolean
  publishOnComplete?: boolean
  pipelineId: string
  status: ExecutionStatus
  paused: boolean
  steps: ExecutionStep[]
  currentStepId: string | null
  completedStepIds: string[]
  failedStepId: string | null
  progress: number
  stepStartedAt: string | null
  remainingMs: number
  checkpointStatus: ContentStatus
  failureStepId: string | null
  scheduledAt: string
  eventSequence: number
}

// ============================================================================
// USER PREFERENCES MODEL
// ============================================================================

export interface UserPreferences {
  id: string
  workspaceName: string
  timezone: string
  language: string
  appearance: 'light' | 'dark' | 'system'
  compactDensity: boolean
  reducedMotion: boolean
  notifyPipeline: boolean
  notifyPublishing: boolean
  notifyWarnings: boolean
  weeklyDigest: 'never' | 'monday' | 'friday'
  defaultChannelId: string | null
  defaultVisibility: 'public' | 'private' | 'unlisted'
  defaultPublishTime: string
  defaultPipelineId: string | null
  textProviderId: string | null
  voiceProviderId: string | null
  imageProviderId: string | null
  createdAt: string
  updatedAt: string
}

// ============================================================================
// ANALYTICS MODEL
// ============================================================================

export type ContentType = 'Long-form' | 'Short'

export interface AnalyticsVideo {
  id: string
  contentId: string
  title: string
  channelId: string
  pipelineId: string
  contentType: ContentType
  publishedAt: string
  thumbnail: string
  views: number
  watchTimeHours: number
  averageDurationSeconds: number
  engagementRate: number
  subscribersGained: number
  createdAt: string
  updatedAt: string
}

// ============================================================================
// ACTIVITY MODEL
// ============================================================================

export type ActivityCategory = 
  | 'Upload'
  | 'Generation'
  | 'Scheduling'
  | 'Warning'
  | 'Failure'
  | 'Success'

export type ActivityTone = 
  | 'activity-purple'
  | 'activity-blue'
  | 'activity-green'
  | 'activity-amber'
  | 'activity-red'

export interface Activity {
  relatedChannelId?: string | null
  relatedPipelineId?: string | null
  relatedProviderId?: string | null
  id: string
  category: ActivityCategory
  title: string
  detail: string
  time: string
  icon: string
  tone: ActivityTone
  relatedContentId: string | null
  createdAt: string
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

export type EntityId = string
export type Timestamp = string

export interface BaseEntity {
  id: EntityId
  createdAt: Timestamp
  updatedAt: Timestamp
}

export type EntityWithTimestamps = BaseEntity
