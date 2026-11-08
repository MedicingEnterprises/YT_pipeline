import type { AppState } from '../state/store'
import type { AIProvider, Channel, ContentItem, Pipeline, ScheduledVideo, Job, Activity, AnalyticsVideo, UserPreferences } from '../models'
import { wallTimeNow } from '../state/time'
import { ApiError, type ApiClient } from './client'

export type RecordData = Record<string, any> // Wire records are validated by server schemas; adapters define the UI boundary.
export const enumLabel: Record<string, string> = { TEXT_GENERATION: 'Text generation', TEXT_TO_SPEECH: 'Text-to-speech', IMAGE_GENERATION: 'Image generation', VIDEO_GENERATION: 'Video generation', EMBEDDINGS_ANALYSIS: 'Embeddings / analysis', LONG_FORM: 'Long-form video', SHORT: 'YouTube Short', EXPLAINER: 'Explainer', INTERVIEW: 'Interview', DECIDE_LATER: 'Decide later', MANUAL: 'Publish manually when ready', SCHEDULE: 'Schedule for a date', QUALITY_CHECK: 'Quality check', NEEDS_ATTENTION: 'Needs attention' }
const label = (value: string) => enumLabel[value] ?? value.toLowerCase().replaceAll('_', ' ').replace(/^./, c => c.toUpperCase())
export const wireEnum = (value: string) => Object.entries(enumLabel).find(([, text]) => text === value)?.[0] ?? value.toUpperCase().replaceAll(' ', '_')
const jobStatus = (value: string): Job['status'] => ({ QUEUED: 'pending', PROCESSING: 'running', COMPLETED: 'completed', FAILED: 'failed', CANCELLED: 'cancelled' })[value] as Job['status']
const asMap = <T extends { id: string }>(rows: T[]) => new Map(rows.map(row => [row.id, row]))
const entity = <T>(row: RecordData, fields: RecordData): T => ({ ...row, ...fields }) as T
export function emptyWorkspace(): AppState { return { channels: new Map(), providers: new Map(), content: new Map(), pipelines: new Map(), scheduledVideos: new Map(), jobs: new Map(), analytics: new Map(), activities: [], preferences: null, selectedChannelId: null, selectedPipelineId: null, selectedContentId: null } }
export function decodeWorkspace(raw: RecordData): AppState {
  const timezone = raw.preferences.timezone
  const wall = (instant: string | null) => instant ? wallTimeNow(timezone, new Date(instant)) : ''
  const channels = raw.channels.map((row: RecordData) => entity<Channel>(row, { status: row.status.toLowerCase(), subscribers: row.subscriberCount, videos: '0', initials: row.name.split(/\s+/).map((word: string) => word[0]).join('').slice(0, 2).toUpperCase(), recentActivity: '', activityTime: '', scheduledCount: 0, publishedCount: 0, recentUploads: [] }))
  const providers = raw.providers.map((row: RecordData) => entity<AIProvider>(row, { category: label(row.category), lastUsed: row.lastUsedAt ?? 'Never' }))
  const pipelines = raw.pipelines.map((row: RecordData) => entity<Pipeline>(row, { assignedChannelIds: row.assignments.map((item: RecordData) => item.channelId), lastUsed: row.lastUsedAt ?? 'Never', steps: row.steps.map((step: RecordData) => ({ id: step.id, kind: step.kind === 'SCHEDULE' ? 'Schedule' : label(step.kind), enabled: step.enabled, order: step.order, config: { providerId: step.providerId, instructions: step.instructions } })) }))
  const content = asMap<ContentItem>(raw.content.map((row: RecordData) => ({ ...row, pipelineId: row.pipelineId ?? '', status: label(row.status), format: label(row.format), visibility: row.visibility.toLowerCase(), publishPreference: label(row.publishPreference), scheduledAt: '' })))
  const schedules = raw.schedules.map((row: RecordData): ScheduledVideo => {
    const item = content.get(row.contentId)!
    item.scheduledAt = wall(row.scheduledAt)
    return entity<ScheduledVideo>(row, { title: item.title, thumbnail: item.thumbnail, channelId: item.channelId, pipelineId: item.pipelineId, scheduledAt: wall(row.scheduledAt), status: label(row.status), executionMode: row.executionMode.toLowerCase() })
  })
  const jobs = raw.jobs.map((row: RecordData) => entity<Job>(row, { pipelineStepId: row.pipelineStepId ?? '', kind: row.kind.toLowerCase(), status: jobStatus(row.status), execution: row.execution ?? undefined, queue: { timezone, type: row.type, mode: row.mode.toLowerCase(), scheduleId: row.scheduleId, scheduleKey: row.idempotencyKey, scheduledAt: row.scheduledAt ? wall(row.scheduledAt) : null, pipelineId: row.pipelineId ?? '', claimed: row.claimed, attempt: row.attempt, history: row.events.map((event: RecordData) => ({ status: jobStatus(event.status), at: event.createdAt, message: event.message, attempt: event.attempt })) } }))
  const preferences: UserPreferences = { ...raw.preferences, appearance: raw.preferences.appearance.toLowerCase(), defaultVisibility: raw.preferences.defaultVisibility.toLowerCase(), weeklyDigest: raw.preferences.weeklyDigest.toLowerCase() }
  const activities = raw.activities.map((row: RecordData) => entity<Activity>(row, { category: label(row.category), time: new Date(row.createdAt).toLocaleString(), relatedContentId: row.contentId, relatedChannelId: row.channelId, relatedPipelineId: row.pipelineId, relatedProviderId: row.providerId }))
  const analytics = raw.analytics.map((row: RecordData) => { const item = content.get(row.contentId)!; return entity<AnalyticsVideo>(row, { title: item.title, channelId: item.channelId, pipelineId: item.pipelineId, contentType: item.format === 'YouTube Short' ? 'Short' : 'Long-form', publishedAt: wall(item.publishedAt ?? item.updatedAt).slice(0, 10), thumbnail: item.thumbnail, views: Number(row.views), watchTimeHours: Number(row.watchTimeHours), averageDurationSeconds: Number(row.averageDurationSeconds), engagementRate: Number(row.engagementRate) }) })
  return { ...emptyWorkspace(), channels: asMap(channels), providers: asMap(providers), pipelines: asMap(pipelines), content, scheduledVideos: asMap(schedules), jobs: asMap(jobs), preferences, activities, analytics: asMap(analytics) }
}
/** Reject DST gaps/folds rather than silently changing a user's requested time. */
export function wallToInstant(wall: string, timezone: string): string {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(wall)) throw new ApiError(422, 'INVALID_TIME', 'Choose a valid date and time.')
  const nominal = Date.parse(`${wall}:00Z`)
  const candidates = new Set<number>()
  for (let hour = -36; hour <= 36; hour += 6) {
    const probe = nominal + hour * 3600000
    const local = Date.parse(`${wallTimeNow(timezone, new Date(probe))}:00Z`)
    const candidate = nominal - (local - probe)
    if (wallTimeNow(timezone, new Date(candidate)) === wall) candidates.add(candidate)
  }
  if (candidates.size !== 1) throw new ApiError(422, 'AMBIGUOUS_TIME', 'This local time is skipped or repeated by daylight saving. Choose an unambiguous time.')
  return new Date([...candidates][0]).toISOString()
}
export const paths = { channel: 'channels', provider: 'ai-providers', content: 'content', pipeline: 'pipelines', schedule: 'schedules' } as const
const select = (value: RecordData, keys: string[]) => Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]]))
export function writeBody(kind: keyof typeof paths, value: RecordData, state: AppState, existing = false): RecordData {
  if (kind === 'channel') {
    const match = String(value.scheduleTime ?? '').match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
    const scheduleTime = match ? `${String(Number(match[1]) % 12 + (match[3].toUpperCase() === 'PM' ? 12 : 0)).padStart(2, '0')}:${match[2]}` : value.scheduleTime || '09:00'
    return { ...select(value, ['name', 'handle', 'category', 'color', 'defaultPipelineId']), scheduleTime, scheduleDays: value.scheduleDays === 'Not set' ? '' : value.scheduleDays ?? '', status: wireEnum(value.status) }
  }
  if (kind === 'provider') return { ...select(value, ['name', 'models', 'connected', 'enabled']), category: wireEnum(value.category) }
  if (kind === 'content') return { ...select(value, ['title', 'channelId', 'pipelineId', 'notes', 'thumbnail']), status: wireEnum(value.status), format: wireEnum(value.format), visibility: wireEnum(value.visibility ?? 'private'), publishPreference: wireEnum(value.publishPreference) }
  if (kind === 'pipeline') return { ...select(value, ['name', 'description', 'enabled', 'assignedChannelIds']), steps: value.steps.map((step: RecordData) => ({ ...(existing && /^[0-9a-f-]{36}$/i.test(step.id) ? { id: step.id } : {}), kind: wireEnum(step.kind), enabled: step.enabled, order: step.order, providerId: step.config.providerId, instructions: step.config.instructions })) }
  return { ...(existing ? {} : { contentId: value.contentId }), scheduledAt: wallToInstant(value.scheduledAt, state.preferences?.timezone ?? 'UTC'), timezone: state.preferences?.timezone ?? 'UTC', executionMode: (value.executionMode ?? 'publication').toUpperCase() }
}
export function preferenceBody(value: RecordData): RecordData { return { ...select(value, ['workspaceName', 'timezone', 'language', 'compactDensity', 'reducedMotion', 'notifyPipeline', 'notifyPublishing', 'notifyWarnings', 'defaultChannelId', 'defaultPipelineId', 'textProviderId', 'voiceProviderId', 'imageProviderId', 'defaultPublishTime']), appearance: wireEnum(value.appearance), defaultVisibility: wireEnum(value.defaultVisibility), weeklyDigest: wireEnum(value.weeklyDigest) } }
export async function fetchWorkspace(api: ApiClient, signal?: AbortSignal) { const result = await api.request<{ data: RecordData }>('/api/v1/workspace', 'GET', undefined, signal); return decodeWorkspace(result.data) }
