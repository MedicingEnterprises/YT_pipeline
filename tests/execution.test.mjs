import assert from 'node:assert/strict'
import test from 'node:test'
import { executePipelineCommand, nextExecutionDelay } from '../src/execution/engine.ts'
import { createPipelineRunner } from '../src/execution/runner.ts'
import { getMockInitialState } from '../src/state/mockData.ts'
import { deserializeWorkspace, serializeWorkspace, createWorkspaceSession, WORKSPACE_VERSION } from '../src/state/persistence.ts'
import { executeOperation } from '../src/state/operations.ts'

const startTime = Date.parse('2030-01-01T10:00:00Z')
function harness(kinds = ['Idea', 'Script', 'Voice', 'Visuals', 'Edit', 'Captions', 'Thumbnail', 'Quality check', 'Upload', 'Schedule']) {
  let state = getMockInitialState()
  const steps = kinds.map((kind, order) => ({ id: `test-step-${order}`, kind, order, enabled: true, config: { instructions: `Mock ${kind}`, providerId: null } }))
  const pipeline = { ...state.pipelines.get('pipeline-long-form'), id: 'test-pipeline', name: 'Test workflow', assignedChannelIds: ['channel-1'], steps }
  state.pipelines = new Map(state.pipelines).set(pipeline.id, pipeline)
  state.content = new Map(state.content).set('test-content', { ...state.content.get('content-1'), id: 'test-content', title: 'Execution test', pipelineId: pipeline.id, status: 'Idea', scheduledAt: '', publishPreference: 'Decide later' })
  let now = startTime
  const command = cmd => { const outcome = executePipelineCommand(state, cmd, now); state = outcome.state; return outcome.result }
  const start = (options = {}) => command({ type: 'start', contentId: 'test-content', jobId: 'test-job', options: { durationMs: 10, scheduledAt: '2099-01-01T10:00', ...options } })
  const advance = (ms = 0) => { now += ms; return command({ type: 'tick' }) }
  const finish = () => {
    for (let i = 0; i < 110 && ['QUEUED', 'PROCESSING'].includes(state.jobs.get('test-job').execution.status); i++) {
      const delay = nextExecutionDelay(state, now)
      if (delay === null) break
      advance(delay)
    }
  }
  return { get state() { return state }, set state(value) { state = value }, get now() { return now }, elapse: ms => { now += ms }, command, start, advance, finish, get job() { return state.jobs.get('test-job') }, get run() { return state.jobs.get('test-job').execution }, get item() { return state.content.get('test-content') } }
}
test('canonical configured workflow completes and synchronizes jobs, schedules, content, progress and activity', () => {
  const h = harness()
  assert.equal(h.start().ok, true)
  assert.equal(h.job.status, 'pending')
  assert.equal(h.run.status, 'QUEUED')
  h.finish()
  assert.equal(h.run.status, 'COMPLETED')
  assert.equal(h.job.status, 'completed')
  assert.equal(h.run.progress, 100)
  assert.equal(h.run.completedStepIds.length, 10)
  assert.equal(h.run.currentStepId, null)
  assert.ok(h.job.startedAt)
  assert.ok(h.job.completedAt)
  assert.equal(h.item.status, 'Scheduled')
  assert.equal([...h.state.scheduledVideos.values()].find(row => row.contentId === 'test-content').scheduledAt, '2099-01-01T10:00')
  assert.ok(h.state.activities.some(row => row.title === 'Mock pipeline completed' && row.relatedContentId === 'test-content'))
  assert.doesNotThrow(() => deserializeWorkspace(serializeWorkspace(h.state)))
})
test('configured order, disabled steps, Research/Review and per-kind durations are honored', () => {
  const h = harness(['Research', 'Thumbnail', 'Script', 'Review'])
  const pipeline = h.state.pipelines.get('test-pipeline')
  h.state.pipelines.set(pipeline.id, { ...pipeline, steps: pipeline.steps.map((step, i) => ({ ...step, enabled: i !== 1 })) })
  assert.equal(h.start({ stepDurations: { Research: 25 } }).ok, true)
  assert.deepEqual(h.run.steps.map(step => step.kind), ['Research', 'Script', 'Review'])
  assert.equal(h.run.steps[0].durationMs, 25)
  assert.equal(h.run.steps[0].instructions, 'Mock Research')
  h.advance()
  assert.equal(h.run.status, 'PROCESSING')
  assert.equal(h.job.kind, 'idea_generation')
  h.advance(24)
  assert.equal(h.run.completedStepIds.length, 0)
  h.advance(1)
  assert.equal(h.run.currentStepId, 'test-step-2')
  assert.equal(h.job.pipelineStepId, 'test-step-2')
  assert.equal(h.job.kind, 'script_generation')
  assert.equal(h.run.progress, 33)
  h.finish()
  assert.equal(h.item.status, 'Ready')
})
test('commands are deterministic and never mutate the input workspace', () => {
  const h = harness(['Script'])
  const before = serializeWorkspace(h.state)
  const command = { type: 'start', contentId: 'test-content', jobId: 'deterministic', options: { durationMs: 10 } }
  const first = executePipelineCommand(h.state, command, startTime)
  const second = executePipelineCommand(h.state, command, startTime)
  assert.deepEqual(first, second)
  assert.equal(serializeWorkspace(h.state), before)
})
test('failure retains the checkpoint and retry executes only the failed and following steps', () => {
  const h = harness(['Idea', 'Script', 'Voice'])
  h.start({ failAtStepId: 'test-step-1' })
  h.finish()
  assert.equal(h.run.status, 'FAILED')
  assert.equal(h.run.failedStepId, 'test-step-1')
  assert.equal(h.job.status, 'failed')
  assert.equal(h.item.status, 'Failed')
  assert.deepEqual(h.run.completedStepIds, ['test-step-0'])
  assert.ok(h.job.errorMessage.includes('Simulated failure'))
  assert.equal(h.command({ type: 'retry', jobId: h.job.id }).ok, true)
  assert.equal(h.job.errorMessage, null)
  assert.equal(h.run.failedStepId, null)
  assert.equal(h.job.completedAt, null)
  h.finish()
  assert.equal(h.run.status, 'COMPLETED')
  assert.equal(h.state.activities.filter(row => row.title === 'Mock step started: Idea' && row.relatedContentId === 'test-content').length, 1)
})
test('pause/resume preserves the unfinished duration and never advances while paused', () => {
  const h = harness(['Script', 'Voice'])
  h.start({ durationMs: 100 })
  h.advance()
  h.advance(40)
  assert.equal(h.command({ type: 'pause', jobId: h.job.id }).ok, true)
  assert.equal(h.run.remainingMs, 60)
  assert.equal(nextExecutionDelay(h.state, h.now), null)
  h.advance(5000)
  assert.equal(h.run.completedStepIds.length, 0)
  assert.equal(h.command({ type: 'resume', jobId: h.job.id }).ok, true)
  h.advance(59)
  assert.equal(h.run.completedStepIds.length, 0)
  h.advance(1)
  assert.deepEqual(h.run.completedStepIds, ['test-step-0'])
  h.finish()
  assert.equal(h.run.status, 'COMPLETED')
})
test('queued runs can pause and cancellation is terminal without discarding completed steps', () => {
  const h = harness(['Script', 'Voice'])
  h.start()
  assert.equal(h.command({ type: 'pause', jobId: h.job.id }).ok, true)
  h.advance(100)
  assert.equal(h.job.startedAt, null)
  h.command({ type: 'resume', jobId: h.job.id })
  h.advance(10)
  assert.equal(h.run.completedStepIds.length, 1)
  assert.equal(h.command({ type: 'cancel', jobId: h.job.id }).ok, true)
  assert.equal(h.job.status, 'cancelled')
  assert.equal(h.run.status, 'CANCELLED')
  assert.equal(h.run.completedStepIds.length, 1)
  assert.equal(nextExecutionDelay(h.state, h.now), null)
  h.advance(500)
  assert.equal(h.run.progress, 50)
  for (const type of ['resume', 'pause', 'retry', 'cancel', 'fail']) assert.equal(h.command({ type, jobId: h.job.id }).ok, false)
})
test('active and failed duplicate runs are rejected; terminal reruns require explicit restart', () => {
  const h = harness(['Script'])
  h.start()
  const duplicate = options => h.command({ type: 'start', contentId: 'test-content', jobId: 'second-job', options })
  assert.equal(duplicate({ restart: true }).ok, false)
  h.advance()
  h.command({ type: 'fail', jobId: h.job.id })
  assert.equal(duplicate({ restart: true }).ok, false)
  h.command({ type: 'cancel', jobId: h.job.id })
  assert.equal(duplicate({}).ok, false)
  assert.equal(duplicate({ restart: true }).ok, true)
})
test('invalid commands and options reject atomically', () => {
  const h = harness(['Script'])
  const before = h.state
  for (const durationMs of [0, -1, NaN, Infinity, 1.5, 3600001]) assert.equal(h.start({ durationMs }).ok, false)
  assert.equal(h.start({ failAtStepId: 'missing' }).ok, false)
  assert.equal(h.state, before)
  assert.equal(h.command({ type: 'retry', jobId: 'missing' }).ok, false)
  h.start()
  for (const type of ['resume', 'retry', 'fail']) {
    const previous = h.state
    assert.equal(h.command({ type, jobId: h.job.id }).ok, false)
    assert.equal(h.state, previous)
  }
})
test('persistence restores processing runs paused, preserving completed steps and retry data', () => {
  const h = harness(['Idea', 'Script', 'Voice'])
  h.start({ failAtStepId: 'test-step-2' })
  h.advance(); h.advance(10); h.advance()
  const snapshot = serializeWorkspace(h.state)
  h.state = deserializeWorkspace(snapshot)
  assert.equal(h.run.paused, true)
  assert.equal(h.run.status, 'PROCESSING')
  assert.deepEqual(h.run.completedStepIds, ['test-step-0'])
  h.advance(10000)
  assert.equal(h.run.completedStepIds.length, 1)
  h.command({ type: 'resume', jobId: h.job.id })
  h.finish()
  assert.equal(h.run.status, 'FAILED')
  h.state = deserializeWorkspace(serializeWorkspace(h.state))
  assert.equal(h.run.failedStepId, 'test-step-2')
  h.command({ type: 'retry', jobId: h.job.id })
  h.finish()
  assert.equal(h.run.status, 'COMPLETED')
  assert.equal(h.run.completedStepIds.length, 3)
})
test('schema v1 snapshots migrate without losing data and malformed checkpoints are rejected', () => {
  const h = harness(['Script'])
  const v1 = JSON.parse(serializeWorkspace(h.state)); v1.version = 1
  let raw = JSON.stringify(v1)
  const session = createWorkspaceSession(() => ({ getItem: () => raw, setItem: (_key, value) => { raw = value } }))
  assert.equal(session.status.kind, 'saved')
  assert.equal(session.save(session.state).kind, 'saved')
  assert.equal(JSON.parse(raw).version, WORKSPACE_VERSION)
  h.start(); h.advance()
  const checkpoint = JSON.parse(serializeWorkspace(h.state))
  const job = checkpoint.workspace.jobs.find(row => row.id === 'test-job')
  job.execution.completedStepIds = ['missing']
  assert.throws(() => deserializeWorkspace(JSON.stringify(checkpoint)))
})
test('CRUD cannot corrupt an open checkpoint; deleting content cleans the job and timer work', () => {
  const h = harness(['Script'])
  h.start()
  const original = h.state
  for (const operation of [
    { type: 'save', kind: 'content', mode: 'update', value: { ...h.item, status: 'Ready' } },
    { type: 'delete', kind: 'pipeline', id: 'test-pipeline' },
    { type: 'save', kind: 'pipeline', mode: 'update', value: { ...h.state.pipelines.get('test-pipeline'), enabled: false } },
  ]) { const result = executeOperation(h.state, operation); assert.equal(result.result.ok, false); assert.equal(result.state, original) }
  const edit = executeOperation(h.state, { type: 'save', kind: 'content', mode: 'update', value: { ...h.item, title: 'Safe title edit' } })
  assert.equal(edit.result.ok, true)
  h.state = edit.state
  const deletion = executeOperation(h.state, { type: 'delete', kind: 'content', id: 'test-content' })
  assert.equal(deletion.result.ok, true)
  assert.equal(deletion.state.jobs.has('test-job'), false)
  assert.equal(nextExecutionDelay(deletion.state, h.now), null)
})
test('provider dependency failures are recoverable and active snapshot providers cannot be deleted', () => {
  const h = harness(['Script'])
  const pipeline = h.state.pipelines.get('test-pipeline')
  h.state.pipelines.set(pipeline.id, { ...pipeline, steps: pipeline.steps.map(step => ({ ...step, config: { ...step.config, providerId: 'provider-openai' } })) })
  h.start()
  assert.equal(executeOperation(h.state, { type: 'delete', kind: 'provider', id: 'provider-openai' }).result.ok, false)
  h.state.providers = new Map(h.state.providers).set('provider-openai', { ...h.state.providers.get('provider-openai'), enabled: false })
  h.advance()
  assert.equal(h.run.status, 'FAILED')
  assert.ok(h.job.errorMessage.includes('provider'))
  h.state.providers.set('provider-openai', { ...h.state.providers.get('provider-openai'), enabled: true })
  h.command({ type: 'retry', jobId: h.job.id })
  h.finish()
  assert.equal(h.run.status, 'COMPLETED')
})
test('upload-only workflows mock publication, while Schedule requires a future planned time', () => {
  const upload = harness(['Upload'])
  upload.start(); upload.finish()
  assert.equal(upload.item.status, 'Published')
  assert.equal([...upload.state.scheduledVideos.values()].some(row => row.contentId === 'test-content'), false)
  const schedule = harness(['Schedule'])
  assert.equal(schedule.start({ scheduledAt: '' }).ok, false)
  assert.equal(schedule.start({ scheduledAt: '2001-01-01T10:00' }).ok, false)
  assert.equal(schedule.start().ok, true)
  schedule.finish()
  assert.equal(schedule.item.status, 'Scheduled')
})
test('schedule deadlines and disconnected channels fail safely with no mock publication', () => {
  const h = harness(['Schedule'])
  h.start({ scheduledAt: '2030-01-01T16:00' }) // 10:30 UTC in the seeded workspace timezone
  h.advance()
  h.advance(3600000)
  assert.equal(h.run.status, 'FAILED')
  assert.equal(h.item.status, 'Failed')
  assert.equal([...h.state.scheduledVideos.values()].some(row => row.contentId === 'test-content'), false)
  const disconnected = harness(['Upload'])
  disconnected.state.channels.set('channel-1', { ...disconnected.state.channels.get('channel-1'), status: 'disconnected' })
  assert.equal(disconnected.start().ok, false)
})
test('timer adapter drives all steps and disposes without callbacks changing state', () => {
  const h = harness(['Script', 'Voice'])
  h.start()
  const timers = new Map()
  let counter = 0
  const runner = createPipelineRunner({ getState: () => h.state, now: () => h.now, tick: () => h.advance(), schedule(callback, delay) { const handle = ++counter; timers.set(handle, { callback, delay }); return handle }, clear: handle => timers.delete(handle) })
  runner.wake(); runner.wake()
  assert.equal(timers.size, 1)
  while (timers.size) {
    const [handle, timer] = timers.entries().next().value
    timers.delete(handle)
    h.elapse(timer.delay)
    timer.callback()
  }
  assert.equal(h.run.status, 'COMPLETED')
  assert.equal(timers.size, 0)
  runner.dispose()
  runner.wake()
  assert.equal(timers.size, 0)
})
test('dispose clears scheduled work and stale callbacks cannot advance execution', () => {
  const h = harness(['Script'])
  h.start()
  let callback
  let cleared = false
  const driver = createPipelineRunner({ getState: () => h.state, now: () => h.now, tick: () => h.advance(), schedule: work => { callback = work; return 1 }, clear: () => { cleared = true } })
  driver.wake()
  driver.dispose()
  callback()
  assert.equal(cleared, true)
  assert.equal(h.run.status, 'QUEUED')
})
test('independent content executions progress concurrently without sharing checkpoints', () => {
  const h = harness(['Script', 'Voice'])
  h.state.content.set('other-content', { ...h.item, id: 'other-content', title: 'Another execution' })
  h.start({ failAtStepId: 'test-step-1' })
  assert.equal(h.command({ type: 'start', contentId: 'other-content', jobId: 'other-job', options: { durationMs: 5 } }).ok, true)
  h.advance(); h.advance(5)
  assert.equal(h.state.jobs.get('other-job').execution.completedStepIds.length, 1)
  assert.equal(h.run.completedStepIds.length, 0)
  h.advance(); h.advance(5)
  assert.equal(h.state.jobs.get('other-job').execution.status, 'COMPLETED')
  h.finish()
  assert.equal(h.run.status, 'FAILED')
})
