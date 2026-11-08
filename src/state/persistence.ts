import type { AppState } from './store'
import { getMockInitialState } from './mockData.ts'
import { contentStatuses, providerCategories, stepKinds, isDateTime, isTime } from './validation.ts'
import { executionIsOpen, validExecutionCheckpoint } from '../execution/engine.ts'
import { scheduleKey } from '../execution/queue.ts'

export const WORKSPACE_KEY = 'content-hub.workspace'
export const WORKSPACE_VERSION = 4
const collections = ['channels', 'providers', 'content', 'pipelines', 'scheduledVideos', 'jobs', 'analytics'] as const
export interface WorkspaceStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export type PersistenceStatus = { kind: 'saved' | 'first-run' | 'invalid' | 'unsupported' | 'unavailable' | 'write-error' | 'conflict'; message: string }
type RecordValue = Record<string, unknown>
type Reader = (value: unknown) => unknown
class SnapshotError extends Error {}
class VersionError extends Error {}
function invalid(): never { throw new SnapshotError('Invalid workspace') }
const object = (value: unknown): RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : invalid()
const string: Reader = value => typeof value === 'string' ? value : invalid()
const boolean: Reader = value => typeof value === 'boolean' ? value : invalid()
const number: Reader = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : invalid()
const id: Reader = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(value) ? value : invalid()
const nullable = (read: Reader): Reader => value => value === null ? null : read(value)
const array = (read: Reader): Reader => value => Array.isArray(value) ? value.map(read) : invalid()
const choice = (values: readonly string[]): Reader => value => typeof value === 'string' && values.includes(value) ? value : invalid()
const shape = (fields: Record<string, Reader>): Reader => value => {
  const input = object(value)
  return Object.fromEntries(Object.entries(fields).map(([key, read]) => [key, read(input[key])]).filter(([, item]) => item !== undefined))
}
const timestamps = { createdAt: string, updatedAt: string }
const entity = { id, ...timestamps }
const link = nullable(string)
const visibility = choice(['public', 'private', 'unlisted'])
const step = shape({ id, kind: choice(stepKinds), enabled: boolean, order: number, config: shape({ instructions: string, providerId: link }) })
const execution = shape({ reviewBeforePublishing: value => value === undefined ? undefined : boolean(value), publishOnComplete: value => value === undefined ? undefined : boolean(value), pipelineId: id, status: choice(['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED']), paused: boolean, steps: array(shape({ id, kind: choice(stepKinds), providerId: link, instructions: string, durationMs: number })), currentStepId: nullable(id), completedStepIds: array(id), failedStepId: nullable(id), progress: number, stepStartedAt: link, remainingMs: number, checkpointStatus: choice(contentStatuses), failureStepId: nullable(id), scheduledAt: string, eventSequence: number })
const queue = shape({ timezone: string, type: choice(['PIPELINE_EXECUTION', 'SCHEDULED_PUBLICATION', 'RETRY']), mode: choice(['pipeline', 'publication']), scheduleId: nullable(id), scheduleKey: link, scheduledAt: link, pipelineId: string, claimed: boolean, attempt: number, history: array(shape({ status: choice(['pending', 'running', 'completed', 'failed', 'cancelled']), at: string, message: string, attempt: number })) })
// Explicit allowlists are used on BOTH writes and reads. Unknown fields (including
// credentials or UI drafts) never enter the saved workspace.
const readers: Record<typeof collections[number], Reader> = {
  channels: shape({ ...entity, name: string, handle: string, category: string, subscribers: string, videos: string, initials: string, color: choice(['channel-purple', 'channel-green', 'channel-orange', 'channel-blue']), status: choice(['connected', 'disconnected']), recentActivity: string, activityTime: string, scheduleDays: string, scheduleTime: string, scheduledCount: number, publishedCount: number, defaultPipelineId: link, recentUploads: array(shape({ id, title: string, status: string, date: string, tone: choice(['green', 'blue', 'amber']) })) }),
  providers: shape({ ...entity, name: string, category: choice(providerCategories), connected: boolean, enabled: boolean, models: array(string), lastUsed: string }),
  content: shape({ ...entity, title: string, channelId: string, pipelineId: string, status: choice(contentStatuses), scheduledAt: string, format: choice(['Long-form video', 'YouTube Short', 'Explainer', 'Interview']), publishPreference: choice(['Decide later', 'Publish manually when ready', 'Schedule for a date']), notes: string, thumbnail: string, visibility: value => value === undefined ? undefined : visibility(value) }),
  pipelines: shape({ ...entity, name: string, description: string, assignedChannelIds: array(string), enabled: boolean, lastUsed: string, steps: array(step) }),
  scheduledVideos: shape({ ...entity, executionMode: value => value === undefined ? undefined : choice(['pipeline', 'publication'])(value), contentId: string, title: string, thumbnail: string, channelId: string, pipelineId: string, scheduledAt: string, status: choice(['Scheduled', 'Ready', 'Processing', 'Needs attention']) }),
  jobs: shape({ ...entity, contentId: string, pipelineStepId: string, kind: choice(['idea_generation', 'script_generation', 'voice_generation', 'visual_generation', 'video_editing', 'caption_generation', 'thumbnail_generation', 'quality_check', 'upload', 'scheduling']), status: choice(['pending', 'running', 'completed', 'failed', 'cancelled']), providerId: link, startedAt: link, completedAt: link, errorMessage: link, queue: value => value === undefined ? undefined : queue(value), execution: value => value === undefined ? undefined : execution(value), metadata: value => {
    // Job metadata is domain data, never provider connection configuration.
    const clean = (input: unknown): unknown => {
      if (input === null || typeof input === 'string' || typeof input === 'boolean') return input
      if (typeof input === 'number') return Number.isFinite(input) ? input : invalid()
      if (Array.isArray(input)) return input.map(clean)
      return Object.fromEntries(Object.entries(object(input)).filter(([key]) => !/key|token|secret|password|credential|authorization/i.test(key)).map(([key, item]) => [key, clean(item)]))
    }
    return clean(object(value))
  } }),
  analytics: shape({ ...entity, contentId: string, title: string, channelId: string, pipelineId: string, contentType: choice(['Long-form', 'Short']), publishedAt: string, thumbnail: string, views: number, watchTimeHours: number, averageDurationSeconds: number, engagementRate: number, subscribersGained: number }),
}
const preferences = shape({ ...entity, workspaceName: string, timezone: string, language: choice(['en-US', 'en-GB', 'es', 'fr']), appearance: choice(['light', 'dark', 'system']), compactDensity: boolean, reducedMotion: boolean, notifyPipeline: boolean, notifyPublishing: boolean, notifyWarnings: boolean, weeklyDigest: choice(['never', 'monday', 'friday']), defaultChannelId: link, defaultVisibility: visibility, defaultPublishTime: string, defaultPipelineId: link, textProviderId: link, voiceProviderId: link, imageProviderId: link })
const activity = shape({ id, category: choice(['Upload', 'Generation', 'Scheduling', 'Warning', 'Failure', 'Success']), title: string, detail: string, time: string, icon: string, tone: choice(['activity-purple', 'activity-blue', 'activity-green', 'activity-amber', 'activity-red']), relatedContentId: link, relatedChannelId: value => value === undefined ? undefined : nullable(id)(value), relatedPipelineId: value => value === undefined ? undefined : nullable(id)(value), relatedProviderId: value => value === undefined ? undefined : nullable(id)(value), createdAt: string })

function readWorkspace(value: unknown): AppState {
  const input = object(value)
  const maps = Object.fromEntries(collections.map(key => {
    const rows = array(readers[key])(input[key]) as { id: string }[]
    const map = new Map(rows.map(row => [row.id, row]))
    if (map.size !== rows.length) invalid()
    return [key, map]
  }))
  // The readers above check each field before this boundary cast.
  const state = { ...maps, preferences: preferences(input.preferences), activities: array(activity)(input.activities), selectedChannelId: null, selectedContentId: null, selectedPipelineId: null } as AppState
  const exists = (map: Map<string, unknown>, key: string | null, optional = false) => { if (!(optional && !key) && (!key || !map.has(key))) invalid() }
  for (const channel of state.channels.values()) exists(state.pipelines, channel.defaultPipelineId, true)
  for (const pipeline of state.pipelines.values()) {
    pipeline.assignedChannelIds.forEach(key => exists(state.channels, key))
    if (new Set(pipeline.steps.map(item => item.id)).size !== pipeline.steps.length) invalid()
    pipeline.steps.forEach((item, index) => { if (item.order !== index) invalid(); exists(state.providers, item.config.providerId, true) })
  }
  for (const item of state.content.values()) {
    exists(state.channels, item.channelId)
    exists(state.pipelines, item.pipelineId, true) // Deleting a pipeline deliberately clears links.
    if (item.scheduledAt && !isDateTime(item.scheduledAt)) invalid()
  }
  const scheduledContent = new Set<string>()
  const statuses = { Scheduled: ['Scheduled'], Ready: ['Ready'], Processing: ['Generating', 'Editing', 'Script'], 'Needs attention': ['Failed'] }
  for (const schedule of state.scheduledVideos.values()) {
    const item = state.content.get(schedule.contentId)
    if (!item || scheduledContent.has(item.id) || !isDateTime(schedule.scheduledAt) || schedule.scheduledAt !== item.scheduledAt || !statuses[schedule.status].includes(item.status)) invalid()
    if (schedule.channelId !== item.channelId || schedule.pipelineId !== item.pipelineId || schedule.title !== item.title || schedule.thumbnail !== item.thumbnail) invalid()
    scheduledContent.add(item.id)
  }
  for (const item of state.content.values()) if (Boolean(item.scheduledAt) !== scheduledContent.has(item.id)) invalid()
  const openContent = new Set<string>()
  const queueKeys = new Set<string>()
  for (const job of state.jobs.values()) {
    exists(state.content, job.contentId); exists(state.providers, job.providerId, true)
    if (!validExecutionCheckpoint(job)) invalid()
    if (job.queue) {
      const item = job.queue
      try { if (!item.timezone) invalid(); new Intl.DateTimeFormat('en', { timeZone: item.timezone }) } catch { invalid() }
      if (!Number.isInteger(item.attempt) || item.attempt < 1 || !item.history.length || item.history.at(-1)!.status !== job.status || item.history.at(-1)!.attempt !== item.attempt) invalid()
      if (item.history.some(event => !Number.isFinite(Date.parse(event.at)) || !Number.isInteger(event.attempt) || event.attempt < 1 || event.attempt > item.attempt)) invalid()
      if (item.scheduledAt !== null && !isDateTime(item.scheduledAt)) invalid()
      if (item.scheduleKey !== null) { if (queueKeys.has(item.scheduleKey)) invalid(); queueKeys.add(item.scheduleKey) }
      if (item.scheduleId === null ? item.scheduleKey !== null || item.scheduledAt !== null || !job.execution : item.scheduleKey === null || item.scheduledAt === null) invalid()
      if (job.execution && job.execution.pipelineId !== item.pipelineId) invalid()
      if (job.execution && (item.mode !== 'pipeline' || !item.claimed)) invalid()
      if (item.type === 'PIPELINE_EXECUTION' && item.mode !== 'pipeline' || item.type === 'SCHEDULED_PUBLICATION' && item.mode !== 'publication') invalid()
      if (!item.claimed && job.status === 'pending') {
        const schedule = state.scheduledVideos.get(item.scheduleId!)
        if (!schedule || schedule.status !== 'Scheduled' || scheduleKey(state, schedule) !== item.scheduleKey) invalid()
      }
      if (!job.execution) {
        if ([job.startedAt, job.completedAt].some(value => value !== null && !Number.isFinite(Date.parse(value)))) invalid()
        if (['completed', 'failed', 'cancelled'].includes(job.status) !== (job.completedAt !== null)) invalid()
        if (job.status === 'running' && (!item.claimed || !job.startedAt || !Number.isFinite(Date.parse(job.startedAt)))) invalid()
        if (job.status === 'failed' && !job.errorMessage) invalid()
      }
    }
    if (executionIsOpen(job)) {
      const run = job.execution!
      exists(state.pipelines, run.pipelineId)
      if (openContent.has(job.contentId) || state.content.get(job.contentId)!.pipelineId !== run.pipelineId) invalid()
      if (state.content.get(job.contentId)!.status !== (run.status === 'FAILED' ? 'Failed' : run.checkpointStatus)) invalid()
      openContent.add(job.contentId)
      run.steps.forEach(step => exists(state.providers, step.providerId, true))
    }
  }
  // Analytics can retain historical metadata, but its owning content must exist.
  for (const row of state.analytics.values()) { exists(state.content, row.contentId); exists(state.channels, row.channelId); exists(state.pipelines, row.pipelineId, true) }
  state.activities.forEach(item => exists(state.content, item.relatedContentId, true))
  if (new Set(state.activities.map(item => item.id)).size !== state.activities.length) invalid()
  const prefs = state.preferences!
  try { if (!prefs.timezone) invalid(); new Intl.DateTimeFormat('en', { timeZone: prefs.timezone }) } catch { invalid() }
  if (!isTime(prefs.defaultPublishTime)) invalid()
  exists(state.channels, prefs.defaultChannelId, true); exists(state.pipelines, prefs.defaultPipelineId, true)
  for (const key of ['textProviderId', 'voiceProviderId', 'imageProviderId'] as const) exists(state.providers, prefs[key], true)
  // Do not replay CRUD validation: historical dates and dependencies disabled after
  // creation are legitimate saved state, not malformed snapshots.
  return state
}

export function serializeWorkspace(state: AppState): string {
  for (const key of collections) for (const [mapId, item] of state[key]) if (mapId !== item.id) invalid()
  const data = Object.fromEntries(collections.map(key => [key, [...state[key].values()]]))
  const clean = readWorkspace({ ...data, preferences: state.preferences, activities: state.activities })
  return JSON.stringify({ version: WORKSPACE_VERSION, workspace: { ...Object.fromEntries(collections.map(key => [key, [...clean[key].values()]])), preferences: clean.preferences, activities: clean.activities } })
}
export function deserializeWorkspace(raw: string): AppState {
  const envelope = object(JSON.parse(raw))
  if (!Number.isInteger(envelope.version)) invalid()
  if (![1, 2, 3, WORKSPACE_VERSION].includes(envelope.version as number)) throw new VersionError('Unsupported workspace version')
  if ((envelope.version as number) < 3) {
    const workspace = object(envelope.workspace)
    if (Array.isArray(workspace.jobs) && workspace.jobs.some(job => object(job).queue !== undefined)) invalid()
  }
  // Version 1 had no execution checkpoints; its existing entities need no rewrite.
  if (envelope.version === 1) {
    const workspace = object(envelope.workspace)
    if (Array.isArray(workspace.jobs) && workspace.jobs.some(job => object(job).execution !== undefined)) invalid()
  }
  const state = readWorkspace(envelope.workspace)
  for (const [id, job] of state.jobs) if (job.queue && !job.execution && job.status === 'running') {
    state.jobs.set(id, { ...job, status: 'pending', startedAt: null, completedAt: null, queue: { ...job.queue, history: [...job.queue.history, { status: 'pending', at: job.updatedAt, message: 'Interrupted mock publication requeued after restart', attempt: job.queue.attempt }] } })
  }
  for (const [id, job] of state.jobs) if (job.execution && ['QUEUED', 'PROCESSING'].includes(job.execution.status)) {
    // Resume explicitly from the last saved checkpoint. Do not count browser
    // downtime as execution or silently publish content after a reload.
    state.jobs.set(id, { ...job, execution: { ...job.execution, paused: true, stepStartedAt: null } })
  }
  return state
}
export function createResetWorkspace(): AppState {
  const seed = getMockInitialState()
  return { ...seed, ...Object.fromEntries(collections.map(key => [key, new Map()])), activities: [], preferences: { ...seed.preferences, defaultChannelId: null, defaultPipelineId: null, textProviderId: null, voiceProviderId: null, imageProviderId: null }, selectedChannelId: null, selectedContentId: null, selectedPipelineId: null }
}

export function createWorkspaceSession(getStorage: () => WorkspaceStorage = () => window.localStorage) {
  let state: AppState = getMockInitialState()
  let expected: string | null = null
  let blocked = false
  let status: PersistenceStatus = { kind: 'first-run', message: '' }
  try {
    expected = getStorage().getItem(WORKSPACE_KEY)
    if (expected !== null) { state = deserializeWorkspace(expected); status = { kind: 'saved', message: '' } }
  } catch (error) {
    blocked = true
    status = error instanceof VersionError
      ? { kind: 'unsupported', message: 'This saved workspace uses an unsupported version. It has been preserved. Update the app or deliberately reset the workspace in Settings. Changes in this preview will not be saved.' }
      : error instanceof SnapshotError || error instanceof SyntaxError
        ? { kind: 'invalid', message: 'The saved workspace could not be restored. It has been preserved. Reset the workspace in Settings to start again. Changes in this preview will not be saved.' }
        : { kind: 'unavailable', message: 'Browser storage could not be read. Changes are in memory only. Retry saving after restoring storage access; existing saved data will be protected.' }
  }
  const save = (next: AppState, reset = false): PersistenceStatus => {
    if (blocked && !reset) return status
    try {
      const storage = getStorage()
      // Avoid silently overwriting another tab or data that was unreadable at startup.
      if (!reset && storage.getItem(WORKSPACE_KEY) !== expected) {
        blocked = true
        return status = { kind: 'conflict', message: 'Saved workspace data changed outside this tab. This tab’s changes are in memory only. Reload to restore the saved workspace, or deliberately reset in Settings.' }
      }
      const raw = serializeWorkspace(next)
      if (reset || raw !== expected) storage.setItem(WORKSPACE_KEY, raw)
      expected = raw; blocked = false
      return status = { kind: 'saved', message: '' }
    } catch {
      return status = { kind: 'write-error', message: 'Workspace changes could not be saved to this browser. Storage may be full or unavailable. Your changes remain in memory; free storage or restore access, then retry saving before closing or refreshing.' }
    }
  }
  return { state, get status() { return status }, save,
    verify: (): PersistenceStatus => {
      if (status.kind !== 'saved') return status
      try {
        if (getStorage().getItem(WORKSPACE_KEY) !== expected) {
          blocked = true
          return status = { kind: 'conflict', message: 'Saved workspace data changed outside this tab. Automatic jobs are stopped. Reload this tab before continuing.' }
        }
        return status
      } catch {
        blocked = true
        return status = { kind: 'unavailable', message: 'Browser storage could not be read. Automatic jobs are stopped. Restore storage access and retry saving before continuing.' }
      }
    },
    retry: (next: AppState) => {
      if (status.kind === 'unavailable') blocked = false
      return save(next)
    },
    reset: () => {
      const next = createResetWorkspace()
      const result = save(next, true)
      return { state: result.kind === 'saved' ? next : null, status: result }
    },
  }
}
export type WorkspaceSession = ReturnType<typeof createWorkspaceSession>
