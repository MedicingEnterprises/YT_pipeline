import type { AppState } from '../state/store'
import type { ContentStatus, ExecutionStep, Job, JobKind, PipelineExecution, PipelineStepKind } from '../models'
import { isDateTime, providerTypesForStep, validatePipeline, wallTimeNow, validationError, operationFailure, type OperationResult } from '../state/validation.ts'
import type { Operation } from '../state/operations'

export interface SimulationOptions {
  reviewBeforePublishing?: boolean
  durationMs?: number
  stepDurations?: Partial<Record<PipelineStepKind, number>>
  failAtStepId?: string | null
  scheduledAt?: string
  restart?: boolean
}
export type ExecutionCommand =
  | { type: 'start'; contentId: string; jobId: string; options?: SimulationOptions; scheduledTrigger?: boolean }
  | { type: 'pause' | 'resume' | 'cancel' | 'retry' | 'fail'; jobId: string }
  | { type: 'tick' }
export type ExecutionOutcome = { state: AppState; result: OperationResult }
const kinds: Record<PipelineStepKind, JobKind> = { Idea: 'idea_generation', Research: 'idea_generation', Script: 'script_generation', Voice: 'voice_generation', Visuals: 'visual_generation', Edit: 'video_editing', Captions: 'caption_generation', Thumbnail: 'thumbnail_generation', 'Quality check': 'quality_check', Review: 'quality_check', Upload: 'upload', Schedule: 'scheduling' }
const statuses = { QUEUED: 'pending', PROCESSING: 'running', COMPLETED: 'completed', FAILED: 'failed', CANCELLED: 'cancelled' } as const
const stage: Record<PipelineStepKind, ContentStatus> = { Idea: 'Idea', Research: 'Idea', Script: 'Script', Voice: 'Generating', Visuals: 'Generating', Edit: 'Editing', Captions: 'Editing', Thumbnail: 'Editing', 'Quality check': 'Ready', Review: 'Ready', Upload: 'Ready', Schedule: 'Ready' }
const preparation: ContentStatus[] = ['Idea', 'Script', 'Generating', 'Editing', 'Ready']
export const executionIsOpen = (job: Job) => Boolean(job.execution && !['COMPLETED', 'CANCELLED'].includes(job.execution.status))
export const executionIsRunnable = (job: Job) => Boolean(job.execution && !job.execution.paused && ['QUEUED', 'PROCESSING'].includes(job.execution.status))
const durationValid = (value: number) => Number.isInteger(value) && value >= 1 && value <= 3_600_000
const stamp = (now: number) => new Date(now).toISOString()
function currentStep(execution: PipelineExecution): ExecutionStep { return execution.steps[execution.completedStepIds.length] }

function dependencyError(state: AppState, job: Job): string | null {
  const run = job.execution!
  const content = state.content.get(job.contentId)
  const pipeline = state.pipelines.get(run.pipelineId)
  if (!content || content.pipelineId !== run.pipelineId) return 'The content or its pipeline assignment is no longer available.'
  if (!pipeline?.enabled) return 'The pipeline is unavailable or disabled.'
  if (!state.channels.has(content.channelId)) return 'The content channel is unavailable.'
  const step = currentStep(run)
  if (step.providerId) {
    const provider = state.providers.get(step.providerId)
    if (!provider?.enabled || !providerTypesForStep(step.kind).includes(provider.category)) return 'The step provider is unavailable, disabled, or incompatible.'
  }
  if (!run.reviewBeforePublishing && ['Upload', 'Schedule'].includes(step.kind) && state.channels.get(content.channelId)?.status !== 'connected') return 'Mock-connect the channel before the publishing steps.'
  return null
}

function writeJob(state: AppState, job: Job, now: number, title: string, contentStatus?: ContentStatus): AppState {
  const run = job.execution!
  const nextRun = { ...run, eventSequence: run.eventSequence + 1 }
  const updated = { ...job, execution: nextRun, status: statuses[run.status], updatedAt: stamp(now) }
  const jobs = new Map(state.jobs).set(job.id, updated)
  const content = new Map(state.content)
  const schedules = new Map(state.scheduledVideos)
  const item = content.get(job.contentId)!
  if (contentStatus) {
    const scheduledAt = contentStatus === 'Scheduled' ? run.scheduledAt : ''
    content.set(item.id, { ...item, status: contentStatus, scheduledAt, publishPreference: contentStatus === 'Scheduled' ? 'Schedule for a date' : contentStatus === 'Published' ? 'Publish manually when ready' : 'Decide later', updatedAt: stamp(now) })
    for (const [id, schedule] of schedules) if (schedule.contentId === item.id) schedules.delete(id)
    if (contentStatus === 'Scheduled') {
      const id = `schedule-${job.id}`
      schedules.set(id, { id, contentId: item.id, channelId: item.channelId, pipelineId: item.pipelineId, title: item.title, thumbnail: item.thumbnail, status: 'Scheduled', executionMode: 'publication', scheduledAt, createdAt: stamp(now), updatedAt: stamp(now) })
    }
  }
  const warning = run.status === 'FAILED'
  const publishing = contentStatus === 'Published' || contentStatus === 'Scheduled'
  const notify = warning ? state.preferences?.notifyWarnings : publishing ? state.preferences?.notifyPublishing : state.preferences?.notifyPipeline
  const activities = notify === false ? state.activities : [{ id: `${job.id}-event-${nextRun.eventSequence}`, category: warning ? 'Failure' as const : contentStatus === 'Published' ? 'Upload' as const : publishing ? 'Scheduling' as const : 'Generation' as const, title, detail: `${item.title} · mock execution`, time: 'Just now', icon: 'Activity', tone: warning ? 'activity-red' as const : 'activity-blue' as const, relatedContentId: item.id, createdAt: stamp(now) }, ...state.activities].slice(0, 100)
  return { ...state, jobs, content, scheduledVideos: schedules, activities }
}
function fail(state: AppState, job: Job, now: number, error: string): AppState {
  const run = job.execution!
  return writeJob(state, { ...job, completedAt: stamp(now), errorMessage: error, execution: { ...run, status: 'FAILED', paused: false, failedStepId: run.currentStepId, stepStartedAt: null } }, now, 'Mock pipeline failed', 'Failed')
}
function beginStep(state: AppState, job: Job, now: number): AppState {
  const error = dependencyError(state, job)
  if (error) return fail(state, job, now, error)
  const run = job.execution!
  const step = currentStep(run)
  const previous = state.content.get(job.contentId)!.status
  // Custom workflows may omit stages or order creative steps differently. The
  // engine advances preparation stages monotonically instead of regressing them.
  const candidate = preparation[Math.max(0, preparation.indexOf(previous), preparation.indexOf(stage[step.kind]))]
  const status = run.reviewBeforePublishing && candidate === 'Ready' && previous !== 'Ready' ? 'Editing' : candidate
  return writeJob(state, { ...job, kind: kinds[step.kind], pipelineStepId: step.id, providerId: step.providerId, startedAt: job.startedAt ?? stamp(now), execution: { ...run, status: 'PROCESSING', paused: false, stepStartedAt: stamp(now), checkpointStatus: status } }, now, `Mock step started: ${step.kind}`, status)
}

function tick(state: AppState, now: number): AppState {
  let next = state
  for (const original of state.jobs.values()) {
    if (!executionIsRunnable(original)) continue
    const job = next.jobs.get(original.id)!
    const run = job.execution!
    if (run.status === 'QUEUED') { next = beginStep(next, job, now); continue }
    if (now < Date.parse(run.stepStartedAt!) + run.remainingMs) continue
    const error = dependencyError(next, job)
    if (error) { next = fail(next, job, now, error); continue }
    const step = currentStep(run)
    if (run.failureStepId === step.id) { next = fail(next, job, now, `Simulated failure at ${step.kind}. Retry to continue from this checkpoint.`); continue }
    if (!run.publishOnComplete && !run.reviewBeforePublishing && (step.kind === 'Schedule' || run.completedStepIds.length === run.steps.length - 1 && run.steps.some(item => item.kind === 'Schedule')) && (!isDateTime(run.scheduledAt) || run.scheduledAt <= wallTimeNow(next.preferences?.timezone ?? 'UTC', new Date(now)))) {
      next = fail(next, job, now, 'The planned publishing time has passed. Cancel this run and start a new run with a future time.'); continue
    }
    const completedStepIds = [...run.completedStepIds, step.id]
    const following = run.steps[completedStepIds.length]
    const finished = !following
    const execution: PipelineExecution = { ...run, completedStepIds, currentStepId: following?.id ?? null, progress: Math.floor(completedStepIds.length / run.steps.length * 100), status: finished ? 'COMPLETED' : 'QUEUED', stepStartedAt: null, remainingMs: following?.durationMs ?? 0 }
    const hasSchedule = run.steps.some(item => item.kind === 'Schedule')
    if (finished && !run.reviewBeforePublishing && (run.publishOnComplete || run.steps.some(item => ['Upload', 'Schedule'].includes(item.kind))) && next.channels.get(next.content.get(job.contentId)!.channelId)?.status !== 'connected') {
      next = fail(next, job, now, 'Mock-connect the channel before completing publishing steps.'); continue
    }
    const status = finished && run.reviewBeforePublishing ? 'Ready' : finished && run.publishOnComplete ? 'Published' : finished && hasSchedule ? 'Scheduled' : finished && run.steps.some(item => item.kind === 'Upload') ? 'Published' : undefined
    next = writeJob(next, { ...job, pipelineStepId: following?.id ?? step.id, kind: kinds[following?.kind ?? step.kind], providerId: following?.providerId ?? null, completedAt: finished ? stamp(now) : null, execution }, now, finished ? 'Mock pipeline completed' : `Mock step completed: ${step.kind}`, status)
  }
  return next
}

/** Pure command handler: deterministic for the same state, command, ID and time.
 * A future worker can replace the timer driver without changing React views. */
export function executePipelineCommand(state: AppState, command: ExecutionCommand, now: number): ExecutionOutcome {
  const reject = (message: string): ExecutionOutcome => ({ state, result: validationError({ execution: message }) })
  try {
    if (!Number.isFinite(now)) return reject('Choose a valid execution time.')
    if (command.type === 'tick') return { state: tick(state, now), result: { ok: true, message: 'Mock execution advanced.' } }
    if (command.type === 'start') {
      const options = command.options ?? {}
      if (options.reviewBeforePublishing !== undefined && typeof options.reviewBeforePublishing !== 'boolean') return reject('Choose a valid completion preference.')
      const reviewBeforePublishing = !command.scheduledTrigger && options.reviewBeforePublishing === true
      const item = state.content.get(command.contentId)
      const pipeline = item && state.pipelines.get(item.pipelineId)
      if (!item || !pipeline?.enabled || Object.keys(validatePipeline(pipeline, state)).length) return reject('Choose content with a valid enabled pipeline.')
      if (!state.channels.has(item.channelId)) return reject('Choose an available channel.')
      if (pipeline.assignedChannelIds.length && !pipeline.assignedChannelIds.includes(item.channelId)) return reject('Assign this channel to the pipeline before running it.')
      if (['Published', 'Scheduled'].includes(item.status) || item.scheduledAt) return reject('Published or scheduled content cannot start a pipeline. Unschedule it first or create new content.')
      const previous = [...state.jobs.values()].filter(job => job.contentId === item.id && job.execution)
      if (previous.some(executionIsOpen)) return reject('This content already has an unfinished execution. Resume, retry, or cancel that run.')
      if (previous.length && !options.restart) return reject('Explicitly start a new run to replace a completed or cancelled execution.')
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,69}$/.test(command.jobId) || state.jobs.has(command.jobId)) return reject('Use a new unique job ID.')
      const duration = options.durationMs ?? 1500
      if (!durationValid(duration) || Object.values(options.stepDurations ?? {}).some(value => !durationValid(value))) return reject('Step durations must be whole milliseconds between 1 and 3600000.')
      const steps = [...pipeline.steps].sort((a, b) => a.order - b.order).filter(step => step.enabled).map(step => ({ id: step.id, kind: step.kind, providerId: step.config.providerId, instructions: step.config.instructions, durationMs: options.stepDurations?.[step.kind] ?? duration }))
      if (!steps.length) return reject('Enable at least one step.')
      if (options.failAtStepId && !steps.some(step => step.id === options.failAtStepId)) return reject('Choose an enabled step for failure simulation.')
      const scheduledAt = options.scheduledAt ?? ''
      if (!command.scheduledTrigger && !reviewBeforePublishing && steps.some(step => step.kind === 'Schedule') && (!isDateTime(scheduledAt) || scheduledAt <= wallTimeNow(state.preferences?.timezone ?? 'UTC', new Date(now)))) return reject('Choose a future planned publishing time for the Schedule step.')
      if (!reviewBeforePublishing && steps.some(step => ['Upload', 'Schedule'].includes(step.kind)) && state.channels.get(item.channelId)?.status !== 'connected') return reject('Mock-connect the channel before running publishing steps.')
      const checkpointStatus = item.status === 'Failed' ? 'Idea' : item.status
      const execution: PipelineExecution = { ...(reviewBeforePublishing ? { reviewBeforePublishing: true } : {}), ...(command.scheduledTrigger ? { publishOnComplete: true } : {}), pipelineId: pipeline.id, status: 'QUEUED', paused: false, steps, currentStepId: steps[0].id, completedStepIds: [], failedStepId: null, progress: 0, stepStartedAt: null, remainingMs: steps[0].durationMs, checkpointStatus, failureStepId: options.failAtStepId ?? null, scheduledAt, eventSequence: 0 }
      const job: Job = { id: command.jobId, contentId: item.id, pipelineStepId: steps[0].id, kind: kinds[steps[0].kind], status: 'pending', providerId: steps[0].providerId, startedAt: null, completedAt: null, errorMessage: null, metadata: {}, execution, createdAt: stamp(now), updatedAt: stamp(now) }
      const pipelines = new Map(state.pipelines).set(pipeline.id, { ...pipeline, lastUsed: stamp(now), updatedAt: stamp(now) })
      return { state: writeJob({ ...state, pipelines }, job, now, 'Mock pipeline queued', checkpointStatus), result: { ok: true, message: 'Mock pipeline queued.' } }
    }
    const job = state.jobs.get(command.jobId)
    if (!job?.execution) return reject('This execution is no longer available.')
    const run = job.execution
    if (!state.content.has(job.contentId)) return reject('This content is no longer available.')
    let next: AppState
    switch (command.type) {
      case 'pause': {
        if (!executionIsRunnable(job)) return reject('Only a queued or processing execution can be paused.')
        const remainingMs = run.stepStartedAt ? Math.max(1, run.remainingMs - Math.max(0, now - Date.parse(run.stepStartedAt))) : run.remainingMs
        next = writeJob(state, { ...job, execution: { ...run, paused: true, remainingMs, stepStartedAt: null } }, now, 'Mock pipeline paused'); break
      }
      case 'resume':
        if (!run.paused || !['QUEUED', 'PROCESSING'].includes(run.status)) return reject('Only a paused execution can be resumed.')
        next = beginStep(state, { ...job, execution: { ...run, paused: false } }, now); break
      case 'cancel':
        if (!executionIsOpen(job)) return reject('A terminal execution cannot be cancelled again.')
        next = writeJob(state, { ...job, completedAt: stamp(now), execution: { ...run, status: 'CANCELLED', paused: false, stepStartedAt: null } }, now, 'Mock pipeline cancelled', run.checkpointStatus); break
      case 'fail':
        if (!executionIsRunnable(job) || run.status !== 'PROCESSING') return reject('Only a processing step can simulate a failure.')
        next = fail(state, job, now, 'Simulated failure requested. Retry to continue from the last valid checkpoint.'); break
      case 'retry':
        if (run.status !== 'FAILED') return reject('Only a failed execution can be retried.')
        next = writeJob(state, { ...job, completedAt: null, errorMessage: null, execution: { ...run, status: 'QUEUED', paused: false, failedStepId: null, failureStepId: null, remainingMs: currentStep(run).durationMs, stepStartedAt: null } }, now, 'Mock pipeline retry queued', run.checkpointStatus); break
    }
    return { state: next, result: { ok: true, message: `Mock execution ${command.type === 'retry' ? 'retry queued' : command.type === 'fail' ? 'failed' : command.type === 'pause' ? 'paused' : command.type === 'resume' ? 'resumed' : 'cancelled'}.` } }
  } catch { return { state, result: operationFailure() } }
}

/** Returns a relative delay; the driver never owns domain state. */
export function nextExecutionDelay(state: AppState, now: number): number | null {
  const delays = [...state.jobs.values()].filter(executionIsRunnable).map(job => job.execution!.status === 'QUEUED' ? 0 : Math.max(0, Date.parse(job.execution!.stepStartedAt!) + job.execution!.remainingMs - now))
  return delays.length ? Math.min(...delays) : null
}

/** Protect checkpoint ownership while leaving metadata edits and deletion of
 * content (with existing cascading cleanup) available. */
export function executionOperationError(state: AppState, operation: Operation): string | null {
  if (operation.type === 'preferences') return null
  const id = operation.type === 'delete' ? operation.id : operation.value.id
  const open = [...state.jobs.values()].filter(executionIsOpen)
  if (operation.kind === 'pipeline' && open.some(job => job.execution!.pipelineId === id)) return 'Cancel or finish this pipeline’s executions before changing its definition.'
  if (operation.kind === 'provider' && operation.type === 'delete' && open.some(job => job.execution!.steps.some(step => step.providerId === id))) return 'Cancel or finish executions using this provider before deleting it.'
  if (operation.kind === 'content' && operation.type === 'save' && open.some(job => job.contentId === id)) {
    const previous = state.content.get(id)!
    const value = operation.value
    if (value.status !== previous.status || value.channelId !== previous.channelId || value.pipelineId !== previous.pipelineId || value.scheduledAt !== previous.scheduledAt || value.publishPreference !== previous.publishPreference) return 'Use the execution controls to change status, or cancel the run before changing its assignments or schedule.'
  }
  if (operation.kind === 'schedule') {
    const contentId = operation.type === 'save' ? operation.value.contentId : state.scheduledVideos.get(id)?.contentId
    if (open.some(job => job.contentId === contentId || job.contentId === state.scheduledVideos.get(id)?.contentId)) return 'Cancel or finish this content’s execution before changing its schedule.'
  }
  return null
}

/** Structural cross-field validation after the persistence reader checks types. */
export function validExecutionCheckpoint(job: Job): boolean {
  const run = job.execution
  if (!run) return true
  if (run.reviewBeforePublishing && run.publishOnComplete) return false
  if (!run.steps.length || run.steps.length > 50 || new Set(run.steps.map(step => step.id)).size !== run.steps.length) return false
  const count = run.completedStepIds.length
  if (count > run.steps.length || run.completedStepIds.some((id, index) => id !== run.steps[index].id)) return false
  if (run.progress !== Math.floor(count / run.steps.length * 100) || run.steps.some(step => !durationValid(step.durationMs))) return false
  if (!Number.isInteger(run.eventSequence) || run.eventSequence < 1 || !Number.isFinite(run.remainingMs) || run.remainingMs < 0 || run.remainingMs > (run.steps[count]?.durationMs ?? 0)) return false
  if (job.status !== statuses[run.status]) return false
  if (run.currentStepId !== (run.steps[count]?.id ?? null)) return false
  if (run.status === 'COMPLETED' ? count !== run.steps.length : count === run.steps.length) return false
  if (run.status === 'FAILED' ? run.failedStepId !== run.currentStepId || !job.errorMessage : run.failedStepId !== null && run.status !== 'CANCELLED') return false
  if (run.failureStepId && !run.steps.some(step => step.id === run.failureStepId)) return false
  if (run.paused && !['QUEUED', 'PROCESSING'].includes(run.status)) return false
  if (run.stepStartedAt !== null && !Number.isFinite(Date.parse(run.stepStartedAt))) return false
  if ((run.status === 'PROCESSING' && !run.paused) !== (run.stepStartedAt !== null)) return false
  if (['COMPLETED', 'CANCELLED', 'FAILED'].includes(run.status) !== (job.completedAt !== null)) return false
  if (job.startedAt !== null && !Number.isFinite(Date.parse(job.startedAt)) || job.completedAt !== null && !Number.isFinite(Date.parse(job.completedAt))) return false
  if (!preparation.includes(run.checkpointStatus)) return false
  if (run.scheduledAt && !isDateTime(run.scheduledAt)) return false
  const current = run.steps[count] ?? run.steps.at(-1)!
  return job.pipelineStepId === current.id && job.kind === kinds[current.kind]
}
