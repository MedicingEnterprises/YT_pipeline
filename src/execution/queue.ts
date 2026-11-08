import type { AppState } from '../state/store'
import type { Job, JobStatus, QueueJob, ScheduledVideo } from '../models'
import type { Operation } from '../state/operations'
import { removeSchedule } from '../state/mutations.ts'
import { validatePipeline, validationError, type OperationResult } from '../state/validation.ts'
import { isDue } from '../state/time.ts'
import { executePipelineCommand, executionIsOpen } from './engine.ts'

export const QUEUE_POLL_MS = 1000
export const PUBLICATION_DURATION_MS = 1000
export const queueStatusLabel: Record<JobStatus, string> = { pending: 'QUEUED', running: 'PROCESSING', completed: 'COMPLETED', failed: 'FAILED', cancelled: 'CANCELLED' }
const terminal = (status: JobStatus) => ['completed', 'failed', 'cancelled'].includes(status)
const stamp = (now: number) => new Date(now).toISOString()
export function scheduleMode(state: AppState, schedule: ScheduledVideo): 'pipeline' | 'publication' {
  // Preserve the meaning of schedules produced by Phase 2B before modes existed.
  return schedule.executionMode ?? (schedule.id.startsWith('schedule-') && state.jobs.get(schedule.id.slice(9))?.execution?.status === 'COMPLETED' ? 'publication' : 'pipeline')
}
export function scheduleKey(state: AppState, schedule: ScheduledVideo): string {
  return JSON.stringify([schedule.id, schedule.createdAt, schedule.contentId, schedule.channelId, schedule.pipelineId, schedule.scheduledAt, scheduleMode(state, schedule)])
}
function record(state: AppState, job: Job, status: JobStatus, message: string, now: number, error: string | null = null): AppState {
  const queue = job.queue!
  const history = [...queue.history, { status, at: stamp(now), message: error ? `${message}: ${error}` : message, attempt: queue.attempt }]
  const updated: Job = { ...job, status, errorMessage: error, startedAt: status === 'running' ? job.startedAt ?? stamp(now) : job.startedAt, completedAt: terminal(status) ? stamp(now) : null, updatedAt: stamp(now), queue: { ...queue, history } }
  const notify = status === 'failed' ? state.preferences?.notifyWarnings : state.preferences?.notifyPublishing
  const activities = notify === false ? state.activities : [{ id: `${job.id}-queue-${history.length}`, category: status === 'failed' ? 'Failure' as const : 'Scheduling' as const, title: message, detail: `${state.content.get(job.contentId)?.title ?? 'Unavailable content'} · mock queue`, time: 'Just now', icon: 'Activity', tone: status === 'failed' ? 'activity-red' as const : 'activity-blue' as const, relatedContentId: state.content.has(job.contentId) ? job.contentId : null, createdAt: stamp(now) }, ...state.activities].slice(0, 100)
  return { ...state, jobs: new Map(state.jobs).set(job.id, updated), activities }
}

/** Admission and status reconciliation run on commits, not in React views. */
export function reconcileJobQueue(state: AppState, now: number): AppState {
  let next = state
  for (const original of state.jobs.values()) {
    const job = next.jobs.get(original.id)!
    if (job.execution && !job.queue) {
      const queue: QueueJob = { timezone: state.preferences?.timezone ?? 'UTC', type: 'PIPELINE_EXECUTION', mode: 'pipeline', scheduleId: null, scheduleKey: null, scheduledAt: null, pipelineId: job.execution.pipelineId, claimed: true, attempt: 1, history: [] }
      next = record(next, { ...job, queue }, job.status, `Mock execution ${queueStatusLabel[job.status].toLowerCase()}`, now, job.errorMessage)
    } else if (job.queue) {
      const queue = job.queue
      const schedule = queue.scheduleId ? next.scheduledVideos.get(queue.scheduleId) : undefined
      if (!queue.claimed && job.status === 'pending' && (!schedule || schedule.status !== 'Scheduled' || scheduleKey(next, schedule) !== queue.scheduleKey)) {
        next = record(next, job, 'cancelled', 'Scheduled job cancelled after schedule change', now)
      } else if (!queue.claimed && job.status === 'pending' && queue.timezone !== (next.preferences?.timezone ?? 'UTC')) {
        next = record(next, { ...job, queue: { ...queue, timezone: next.preferences?.timezone ?? 'UTC' } }, 'pending', 'Queued wall time reinterpreted in the updated workspace timezone', now)
      } else if (queue.history.at(-1)?.status !== job.status) {
        next = record(next, job, job.status, `Mock job ${queueStatusLabel[job.status].toLowerCase()}`, now, job.errorMessage)
      }
    }
  }
  for (const schedule of next.scheduledVideos.values()) {
    if (schedule.status !== 'Scheduled') continue
    const key = scheduleKey(next, schedule)
    if ([...next.jobs.values()].some(job => job.queue?.scheduleKey === key)) continue
    let counter = next.jobs.size
    let id = `queue-${now.toString(36)}-${counter}`
    while (next.jobs.has(id)) id = `queue-${now.toString(36)}-${++counter}`
    const mode = scheduleMode(next, schedule)
    const queue: QueueJob = { timezone: next.preferences?.timezone ?? 'UTC', type: mode === 'pipeline' ? 'PIPELINE_EXECUTION' : 'SCHEDULED_PUBLICATION', mode, scheduleId: schedule.id, scheduleKey: key, scheduledAt: schedule.scheduledAt, pipelineId: schedule.pipelineId, claimed: false, attempt: 1, history: [] }
    const job: Job = { id, contentId: schedule.contentId, pipelineStepId: '', kind: 'scheduling', status: 'pending', providerId: null, startedAt: null, completedAt: null, errorMessage: null, metadata: {}, queue, createdAt: stamp(now), updatedAt: stamp(now) }
    next = record(next, job, 'pending', 'Scheduled mock job queued', now)
  }
  return next
}
function validationMessage(state: AppState, job: Job): string | null {
  const item = state.content.get(job.contentId)
  if (!item) return 'The scheduled content is unavailable.'
  if (item.status === 'Published') return 'This content is already published; it will not be triggered again.'
  if (state.channels.get(item.channelId)?.status !== 'connected') return 'The scheduled channel is unavailable or disconnected.'
  if (item.pipelineId !== job.queue!.pipelineId) return 'The scheduled pipeline assignment changed.'
  const pipeline = state.pipelines.get(item.pipelineId)
  if (!pipeline?.enabled || Object.keys(validatePipeline(pipeline, state)).length) return 'The scheduled pipeline is unavailable, disabled, or invalid.'
  if (pipeline.assignedChannelIds.length && !pipeline.assignedChannelIds.includes(item.channelId)) return 'The channel is not assigned to the scheduled pipeline.'
  if ([...state.jobs.values()].some(other => other.id !== job.id && other.contentId === job.contentId && (executionIsOpen(other) || other.queue?.claimed && other.status === 'running'))) return 'Another execution already owns this content.'
  return null
}
function consume(state: AppState, job: Job): AppState {
  const schedule = job.queue?.scheduleId ? state.scheduledVideos.get(job.queue.scheduleId) : undefined
  return schedule && scheduleKey(state, schedule) === job.queue?.scheduleKey ? removeSchedule(state, schedule.id) : state
}
function failJob(state: AppState, job: Job, error: string, now: number): AppState {
  let next = record(state, job, 'failed', 'Scheduled mock job failed', now, error)
  const item = next.content.get(job.contentId)
  const otherOwnsContent = [...next.jobs.values()].some(other => other.id !== job.id && other.contentId === job.contentId && executionIsOpen(other))
  if (item && item.status !== 'Published' && !otherOwnsContent) next = { ...next, content: new Map(next.content).set(item.id, { ...item, status: 'Failed', updatedAt: stamp(now) }) }
  return next
}

/** One atomic browser queue tick. Persisted claims and retained terminal jobs
 * prevent repeated admission/dispatch, including after refresh. */
export function tickJobQueue(state: AppState, now: number): AppState {
  let next = reconcileJobQueue(state, now)
  const pending = [...next.jobs.values()].filter(job => job.queue && !job.execution && job.status === 'pending' && (job.queue.claimed || job.queue.scheduledAt && isDue(job.queue.scheduledAt, next.preferences?.timezone ?? 'UTC', now))).sort((a, b) => a.queue!.scheduledAt!.localeCompare(b.queue!.scheduledAt!) || a.id.localeCompare(b.id))
  for (const original of pending) {
    const job = { ...next.jobs.get(original.id)!, queue: { ...original.queue!, timezone: original.queue!.claimed ? original.queue!.timezone : next.preferences?.timezone ?? 'UTC', claimed: true } }
    const error = validationMessage(next, job)
    next = consume(next, job)
    if (error) { next = failJob(next, job, error, now); continue }
    if (job.queue.mode === 'pipeline') {
      const item = next.content.get(job.contentId)!
      const content = new Map(next.content).set(item.id, { ...item, status: 'Ready' as const, scheduledAt: '', publishPreference: 'Decide later' as const })
      const jobs = new Map(next.jobs); jobs.delete(job.id)
      const outcome = executePipelineCommand({ ...next, content, jobs }, { type: 'start', contentId: job.contentId, jobId: job.id, scheduledTrigger: true, options: { restart: true } }, now)
      if (!outcome.result.ok) { next = failJob(next, job, Object.values(outcome.result.errors).join(' ') || outcome.result.message, now); continue }
      next = { ...outcome.state, jobs: new Map(outcome.state.jobs).set(job.id, { ...outcome.state.jobs.get(job.id)!, queue: job.queue, createdAt: job.createdAt }) }
    } else next = record(next, job, 'running', 'Mock scheduled publication started', now)
  }
  for (const original of next.jobs.values()) {
    if (!original.queue || original.execution || original.status !== 'running' || now < Date.parse(original.startedAt!) + PUBLICATION_DURATION_MS) continue
    const error = validationMessage(next, original)
    if (error) { next = failJob(next, original, error, now); continue }
    const item = next.content.get(original.contentId)!
    next = { ...next, content: new Map(next.content).set(item.id, { ...item, status: 'Published', scheduledAt: '', publishPreference: 'Publish manually when ready', updatedAt: stamp(now) }) }
    next = record(next, original, 'completed', 'Scheduled content mock-published', now)
  }
  const outcome = executePipelineCommand(next, { type: 'tick' }, now)
  return reconcileJobQueue(outcome.state, now)
}

export function queueCommand(state: AppState, jobId: string, action: 'cancel' | 'retry', now: number): { state: AppState; result: OperationResult } {
  const job = state.jobs.get(jobId)
  const reject = (message: string) => ({ state, result: validationError({ queue: message }) })
  if (!job?.queue) return reject('Choose an available queued job.')
  if (action === 'retry' && job.status !== 'failed') return reject('Only failed jobs can be retried.')
  if (action === 'cancel' && !['pending', 'running', 'failed'].includes(job.status)) return reject('This job is already terminal.')
  if (action === 'retry') {
    const item = state.content.get(job.contentId)
    if (item?.scheduledAt || [...state.jobs.values()].some(other => other.id !== job.id && other.contentId === job.contentId && (executionIsOpen(other) || other.queue && ['pending', 'running'].includes(other.status)))) return reject('This content has another schedule or execution. Cancel that work before retrying this job.')
  }
  let next = state
  if (job.execution) {
    const outcome = executePipelineCommand(state, { type: action, jobId }, now)
    if (!outcome.result.ok) return outcome
    next = outcome.state
  } else if (action === 'cancel') next = record(consume(state, job), job, 'cancelled', 'Mock queue job cancelled', now)
  else {
    const item = state.content.get(job.contentId)
    if (!item || item.status === 'Published') return reject('Unavailable or published content cannot be retried.')
    next = { ...state, content: new Map(state.content).set(item.id, { ...item, status: 'Ready', scheduledAt: '', publishPreference: 'Decide later', updatedAt: stamp(now) }) }
  }
  if (action === 'retry') {
    const updated = next.jobs.get(job.id)!
    next = record(next, { ...updated, startedAt: updated.execution ? updated.startedAt : null, queue: { ...job.queue, type: 'RETRY', claimed: true, attempt: job.queue.attempt + 1 } }, 'pending', 'Mock job retry queued', now)
  }
  return { state: reconcileJobQueue(next, now), result: { ok: true, message: action === 'retry' ? 'Mock job retry queued.' : 'Mock job cancelled.' } }
}

export function queueOperationError(state: AppState, operation: Operation): string | null {
  if (operation.type === 'preferences' || operation.type === 'delete' && operation.kind === 'content') return null
  const owned = [...state.jobs.values()].filter(job => job.queue && !job.execution && job.status === 'running')
  if (operation.kind === 'content' && operation.type === 'save') {
    const old = state.content.get(operation.value.id)
    const value = operation.value
    if (old && owned.some(job => job.contentId === old.id) && ['status', 'channelId', 'pipelineId', 'scheduledAt', 'publishPreference'].some(key => old[key as keyof typeof old] !== value[key as keyof typeof value])) return 'Cancel the processing queue job before changing its content status or assignments.'
  }
  if (operation.kind === 'schedule' && operation.type === 'save' && owned.some(job => job.contentId === operation.value.contentId)) return 'Cancel the processing queue job before scheduling this content again.'
  if (operation.kind === 'pipeline' && owned.some(job => job.queue!.pipelineId === (operation.type === 'delete' ? operation.id : operation.value.id))) return 'Finish or cancel processing queue jobs before changing this pipeline.'
  return null
}
