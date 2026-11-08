import test from 'node:test'
import assert from 'node:assert/strict'
import { tickJobQueue, reconcileJobQueue, queueCommand, PUBLICATION_DURATION_MS } from '../src/execution/queue.ts'
import { executePipelineCommand } from '../src/execution/engine.ts'
import { getMockInitialState } from '../src/state/mockData.ts'
import { createResetWorkspace, serializeWorkspace, deserializeWorkspace, WORKSPACE_VERSION } from '../src/state/persistence.ts'
import { executeOperation } from '../src/state/operations.ts'
import { isDue, wallTimeNow, workspaceToday, calendarDate, calendarKey, addDays, formatWallTime } from '../src/state/time.ts'
import { validateSchedule } from '../src/state/validation.ts'
import { createPipelineRunner } from '../src/execution/runner.ts'
import { advanceDurableQueue, createQueueDispatcher } from '../src/execution/dispatcher.ts'
import { createWorkspaceSession } from '../src/state/persistence.ts'

const instant = Date.parse('2030-01-01T10:00:00Z')
function harness(mode = 'pipeline', planned = '2030-01-01T10:00', timezone = 'UTC') {
  const seed = getMockInitialState()
  let state = createResetWorkspace()
  state.preferences = { ...state.preferences, timezone }
  state.channels.set('channel-1', { ...seed.channels.get('channel-1'), defaultPipelineId: 'test-pipeline' })
  state.pipelines.set('test-pipeline', { ...seed.pipelines.get('pipeline-long-form'), id: 'test-pipeline', name: 'Queue pipeline', assignedChannelIds: ['channel-1'], steps: ['Script', 'Upload', 'Schedule'].map((kind, order) => ({ id: `step-${order}`, kind, order, enabled: true, config: { instructions: '', providerId: null } })) })
  const add = (id, date = planned, action = mode) => {
    state.content.set(id, { ...seed.content.get('content-1'), id, title: id, pipelineId: 'test-pipeline', status: 'Scheduled', scheduledAt: date, publishPreference: 'Schedule for a date' })
    state.scheduledVideos.set(`schedule-${id}`, { id: `schedule-${id}`, contentId: id, title: id, thumbnail: state.content.get(id).thumbnail, channelId: 'channel-1', pipelineId: 'test-pipeline', status: 'Scheduled', scheduledAt: date, executionMode: action, createdAt: '2030-01-01T00:00:00Z', updatedAt: '2030-01-01T00:00:00Z' })
  }
  add('queued-content')
  let now = instant
  const tick = (ms = 0) => { now += ms; state = tickJobQueue(state, now) }
  const command = action => { const outcome = queueCommand(state, [...state.jobs.keys()][0], action, now); state = outcome.state; return outcome.result }
  const finish = () => { for (let i = 0; i < 20 && [...state.jobs.values()].some(job => ['pending', 'running'].includes(job.status)); i++) tick(1500) }
  return { get state() { return state }, set state(value) { state = value }, get job() { return [...state.jobs.values()][0] }, get now() { return now }, add, tick, command, finish }
}
test('due schedule starts its configured pipeline once and ends in mock publication without a schedule loop', () => {
  const h = harness()
  h.tick()
  assert.equal(h.state.jobs.size, 1)
  assert.equal(h.job.queue.claimed, true)
  assert.equal(h.job.queue.type, 'PIPELINE_EXECUTION')
  assert.equal(h.job.status, 'running')
  assert.equal(h.job.execution.publishOnComplete, true)
  assert.equal(h.state.scheduledVideos.size, 0)
  h.finish()
  assert.equal(h.job.status, 'completed')
  assert.equal(h.state.content.get('queued-content').status, 'Published')
  assert.equal(h.job.execution.progress, 100)
  h.tick(10000)
  assert.equal(h.state.jobs.size, 1)
  assert.ok(h.job.queue.history.some(event => event.status === 'running'))
  assert.equal(h.job.queue.history.at(-1).status, 'completed')
  assert.doesNotThrow(() => serializeWorkspace(h.state))
})
test('future jobs remain queued until the workspace due minute', () => {
  const h = harness('pipeline', '2030-01-01T10:01')
  h.tick()
  assert.equal(h.job.status, 'pending')
  assert.equal(h.job.execution, undefined)
  assert.equal(h.job.queue.claimed, false)
  h.tick(59999)
  assert.equal(h.job.status, 'pending')
  h.tick(1)
  assert.equal(h.job.status, 'running')
})
test('prepared publication uses the queue without rerunning generation', () => {
  const h = harness('publication')
  h.tick()
  assert.equal(h.job.queue.type, 'SCHEDULED_PUBLICATION')
  assert.equal(h.job.execution, undefined)
  assert.equal(h.job.status, 'running')
  h.tick(PUBLICATION_DURATION_MS - 1)
  assert.equal(h.job.status, 'running')
  h.tick(1)
  assert.equal(h.job.status, 'completed')
  assert.equal(h.state.content.get('queued-content').status, 'Published')
})
test('due detection is independent of the PC timezone and follows workspace timezone changes', () => {
  assert.equal(wallTimeNow('Asia/Kolkata', new Date(instant)), '2030-01-01T15:30')
  assert.equal(isDue('2030-01-01T15:30', 'Asia/Kolkata', instant), true)
  assert.equal(isDue('2030-01-01T15:31', 'Asia/Kolkata', instant), false)
  assert.equal(isDue('2030-01-01T10:00', 'America/New_York', instant), false)
  const h = harness('publication', '2030-01-01T10:00', 'America/New_York')
  h.tick(); assert.equal(h.job.status, 'pending')
  h.state.preferences = { ...h.state.preferences, timezone: 'UTC' }
  h.tick(); assert.equal(h.job.status, 'running')
})
test('workspace calendar and validation use the same wall date across day boundaries', () => {
  const now = Date.parse('2030-01-01T23:45:00Z')
  assert.equal(workspaceToday('Asia/Kolkata', new Date(now)), '2030-01-02')
  assert.equal(calendarKey(calendarDate('2030-01-02T05:15')), '2030-01-02')
  assert.equal(addDays('2030-01-02', -1), '2030-01-01')
  assert.ok(formatWallTime('2030-01-02T05:15', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).includes('05:15'))
  const h = harness('publication', '2030-01-02T05:15', 'Asia/Kolkata')
  const schedule = h.state.scheduledVideos.values().next().value
  const stateWithoutSchedule = { ...h.state, scheduledVideos: new Map(), content: new Map(h.state.content).set('queued-content', { ...h.state.content.get('queued-content'), status: 'Ready', scheduledAt: '' }) }
  assert.ok(validateSchedule(schedule, stateWithoutSchedule, new Date(now)).scheduledAt)
  assert.equal(isDue(schedule.scheduledAt, 'Asia/Kolkata', now), true)
})
test('DST gaps become due after the gap and repeated minutes never trigger a second job', () => {
  assert.equal(isDue('2030-03-10T02:30', 'America/New_York', Date.parse('2030-03-10T06:59:00Z')), false)
  assert.equal(isDue('2030-03-10T02:30', 'America/New_York', Date.parse('2030-03-10T07:00:00Z')), true)
  const h = harness('publication', '2030-11-03T01:30', 'America/New_York')
  h.state = tickJobQueue(h.state, Date.parse('2030-11-03T05:30:00Z'))
  h.state = tickJobQueue(h.state, Date.parse('2030-11-03T05:31:00Z'))
  h.state = tickJobQueue(h.state, Date.parse('2030-11-03T06:30:00Z'))
  assert.equal(h.state.jobs.size, 1)
  assert.equal(h.job.status, 'completed')
})
test('multiple due items are independently claimed without duplicate dispatch', () => {
  const h = harness()
  h.add('another-content')
  h.add('prepared-content', '2030-01-01T10:00', 'publication')
  h.tick(); h.tick()
  assert.equal(h.state.jobs.size, 3)
  assert.equal([...h.state.jobs.values()].filter(job => job.status === 'running').length, 3)
  h.finish()
  assert.ok([...h.state.jobs.values()].every(job => job.status === 'completed'))
  assert.ok([...h.state.content.values()].every(item => item.status === 'Published'))
})
test('queued cancellation unschedules content and prevents future automatic re-admission', () => {
  const h = harness('pipeline', '2030-01-01T10:01')
  h.tick()
  assert.equal(h.command('cancel').ok, true)
  assert.equal(h.job.status, 'cancelled')
  assert.equal(h.state.content.get('queued-content').status, 'Ready')
  assert.equal(h.state.scheduledVideos.size, 0)
  h.tick(120000)
  assert.equal(h.state.jobs.size, 1)
  assert.equal(h.job.execution, undefined)
})
test('processing cancellation stops both pipeline and publication jobs', () => {
  for (const mode of ['pipeline', 'publication']) {
    const h = harness(mode)
    h.tick()
    assert.equal(h.command('cancel').ok, true)
    h.tick(10000)
    assert.equal(h.job.status, 'cancelled')
    assert.notEqual(h.state.content.get('queued-content').status, 'Published')
    assert.equal(h.command('retry').ok, false)
  }
})
test('disconnected channel fails once, reports its error, and retries after repair', () => {
  const h = harness()
  h.state.channels.set('channel-1', { ...h.state.channels.get('channel-1'), status: 'disconnected' })
  h.tick()
  assert.equal(h.job.status, 'failed')
  assert.ok(h.job.errorMessage.includes('disconnected'))
  assert.equal(h.state.content.get('queued-content').status, 'Failed')
  h.tick(5000); assert.equal(h.state.jobs.size, 1)
  h.state.channels.set('channel-1', { ...h.state.channels.get('channel-1'), status: 'connected' })
  assert.equal(h.command('retry').ok, true)
  assert.equal(h.job.queue.type, 'RETRY')
  assert.equal(h.job.queue.attempt, 2)
  h.finish()
  assert.equal(h.job.status, 'completed')
  assert.equal(h.job.queue.history.filter(event => event.status === 'failed').length, 1)
})
test('pipeline failures retry from the valid checkpoint and retain attempt history', () => {
  const h = harness()
  h.tick(); h.tick(1500); h.tick()
  const jobId = h.job.id
  h.state = executePipelineCommand(h.state, { type: 'fail', jobId }, h.now).state
  h.state = reconcileJobQueue(h.state, h.now)
  assert.equal(h.job.execution.completedStepIds.length, 1)
  assert.equal(h.command('retry').ok, true)
  assert.equal(h.job.queue.attempt, 2)
  h.finish()
  assert.equal(h.job.status, 'completed')
  assert.equal(h.job.execution.completedStepIds.length, 3)
  assert.equal(h.state.activities.filter(row => row.title === 'Mock step started: Script').length, 1)
})
test('publication failures can retry without creating another job', () => {
  const h = harness('publication')
  h.tick()
  h.state.channels.set('channel-1', { ...h.state.channels.get('channel-1'), status: 'disconnected' })
  h.tick(1000)
  assert.equal(h.job.status, 'failed')
  h.state.channels.set('channel-1', { ...h.state.channels.get('channel-1'), status: 'connected' })
  assert.equal(h.command('retry').ok, true)
  h.finish()
  assert.equal(h.job.status, 'completed')
  assert.equal(h.state.jobs.size, 1)
})
test('rescheduling cancels the old queued entry and admits the replacement exactly once', () => {
  const h = harness('pipeline', '2030-01-01T11:00')
  h.tick()
  const schedule = h.state.scheduledVideos.values().next().value
  const result = executeOperation(h.state, { type: 'save', kind: 'schedule', mode: 'update', value: { ...schedule, scheduledAt: '2030-01-01T12:00' } }, new Date(instant))
  assert.equal(result.result.ok, true)
  h.state = reconcileJobQueue(result.state, h.now)
  assert.equal(h.state.jobs.size, 2)
  assert.equal([...h.state.jobs.values()].filter(job => job.status === 'cancelled').length, 1)
  assert.equal([...h.state.jobs.values()].filter(job => job.status === 'pending').length, 1)
  assert.doesNotThrow(() => serializeWorkspace(h.state))
})
test('refresh preserves queued and terminal jobs and pauses interrupted pipelines without duplication', () => {
  const h = harness()
  h.tick(); h.tick(1500); h.tick()
  h.state = deserializeWorkspace(serializeWorkspace(h.state))
  assert.equal(h.job.execution.paused, true)
  h.tick(10000)
  assert.equal(h.state.jobs.size, 1)
  assert.equal(h.job.execution.completedStepIds.length, 1)
  h.state = executePipelineCommand(h.state, { type: 'resume', jobId: h.job.id }, h.now).state
  h.finish()
  h.state = deserializeWorkspace(serializeWorkspace(h.state))
  h.tick(10000)
  assert.equal(h.state.jobs.size, 1)
  assert.equal(h.job.status, 'completed')
})
test('interrupted publication requeues the same claimed job safely on restart', () => {
  const h = harness('publication')
  h.tick()
  const id = h.job.id
  h.state = deserializeWorkspace(serializeWorkspace(h.state))
  assert.equal(h.job.status, 'pending')
  assert.equal(h.job.queue.claimed, true)
  h.tick(10000)
  assert.equal(h.job.id, id)
  assert.equal(h.job.status, 'running')
  h.tick(1000)
  assert.equal(h.job.status, 'completed')
  assert.equal(h.state.jobs.size, 1)
})
test('overdue persisted queued jobs start only when the active app ticks again', () => {
  const h = harness('publication', '2030-01-01T10:01')
  h.tick()
  const snapshot = serializeWorkspace(h.state)
  h.state = deserializeWorkspace(snapshot)
  assert.equal(h.job.status, 'pending')
  h.tick(3600000)
  assert.equal(h.job.status, 'running')
})
test('old schema snapshots migrate and invalid queue history is rejected', () => {
  const h = harness()
  const old = JSON.parse(serializeWorkspace(h.state)); old.version = 2
  assert.doesNotThrow(() => deserializeWorkspace(JSON.stringify(old)))
  h.tick()
  const envelope = JSON.parse(serializeWorkspace(h.state))
  assert.equal(envelope.version, WORKSPACE_VERSION)
  envelope.workspace.jobs[0].queue.history = []
  assert.throws(() => deserializeWorkspace(JSON.stringify(envelope)))
})
test('processing publication owns content status and invalid retry/cancel transitions are atomic', () => {
  const h = harness('publication')
  h.tick()
  const before = h.state
  const result = executeOperation(h.state, { type: 'save', kind: 'content', mode: 'update', value: { ...h.state.content.get('queued-content'), status: 'Published' } })
  assert.equal(result.result.ok, false)
  assert.equal(result.state, before)
  assert.equal(h.command('retry').ok, false)
  h.finish()
  assert.equal(h.command('retry').ok, false)
  assert.equal(h.command('cancel').ok, false)
})
test('polling adapter checks due work while idle and stops after disposal', () => {
  const h = harness('publication', '2030-01-01T10:01')
  let callback
  let delay
  let stopped = false
  const runner = createPipelineRunner({ getState: () => h.state, now: () => h.now, tick: () => h.tick(), delay: () => 1000, schedule: (work, wait) => { callback = work; delay = wait; return 1 }, clear: () => { stopped = true } })
  runner.wake()
  assert.equal(delay, 1000)
  h.tick(60000); callback()
  assert.equal(h.job.status, 'running')
  runner.dispose(); assert.equal(stopped, true)
})
test('automatic jobs require a durable checkpoint and stale tabs cannot dispatch work', () => {
  const h = harness('publication')
  h.state = reconcileJobQueue(h.state, h.now)
  let raw = serializeWorkspace(h.state)
  let fail = true
  const storage = { getItem: () => raw, setItem: (_key, value) => { if (fail) throw new Error('QuotaExceededError'); raw = value } }
  const session = createWorkspaceSession(() => storage)
  const before = session.state
  const outcome = advanceDurableQueue(before, h.now, session)
  assert.equal(outcome.state, before)
  assert.equal(outcome.status.kind, 'write-error')
  assert.equal(deserializeWorkspace(raw).jobs.values().next().value.queue.claimed, false)
  fail = false
  session.retry(before)
  const progressed = advanceDurableQueue(before, h.now, session)
  assert.equal(progressed.status.kind, 'saved')
  assert.equal(progressed.state.jobs.values().next().value.status, 'running')
  const stale = createWorkspaceSession(() => storage)
  raw = serializeWorkspace({ ...progressed.state, preferences: { ...progressed.state.preferences, workspaceName: 'Other tab update' } })
  assert.equal(advanceDurableQueue(stale.state, h.now + 2000, stale).state, stale.state)
  assert.equal(stale.status.kind, 'conflict')
})
test('dispatcher serializes asynchronous lock requests and ignores disposed callbacks', async () => {
  let work
  let resolve
  let runs = 0
  let settled = 0
  const dispatcher = createQueueDispatcher({ run: () => { runs++ }, settled: () => { settled++ }, lock: callback => { work = callback; return new Promise(done => { resolve = done }) } })
  dispatcher.tick(); dispatcher.tick()
  assert.equal(dispatcher.busy, true)
  work()
  resolve()
  await new Promise(done => setImmediate(done))
  assert.equal(runs, 1)
  assert.equal(settled, 1)
  dispatcher.tick()
  dispatcher.dispose()
  work(); resolve()
  await new Promise(done => setImmediate(done))
  assert.equal(runs, 1)
})
test('retry cannot overwrite a newer schedule and historical failure details survive repair', () => {
  const h = harness('publication')
  h.state.channels.set('channel-1', { ...h.state.channels.get('channel-1'), status: 'disconnected' })
  h.tick()
  assert.ok(h.job.queue.history.at(-1).message.includes('disconnected'))
  const failedId = h.job.id
  h.state.channels.set('channel-1', { ...h.state.channels.get('channel-1'), status: 'connected' })
  h.add('queued-content', '2030-01-01T11:00')
  h.state = reconcileJobQueue(h.state, h.now)
  const before = h.state
  const outcome = queueCommand(h.state, failedId, 'retry', h.now)
  assert.equal(outcome.result.ok, false)
  assert.equal(outcome.state, before)
  assert.equal(h.state.content.get('queued-content').status, 'Scheduled')
  assert.doesNotThrow(() => serializeWorkspace(h.state))
})
test('missing content, disconnected channels and disabled pipelines report failures safely', () => {
  const h = harness()
  h.state.pipelines.set('test-pipeline', { ...h.state.pipelines.get('test-pipeline'), enabled: false })
  h.tick()
  assert.equal(h.job.status, 'failed')
  assert.ok(h.job.errorMessage.includes('pipeline'))
  assert.doesNotThrow(() => serializeWorkspace(h.state))
  const missing = harness()
  missing.state.content.delete('queued-content')
  missing.tick()
  assert.equal(missing.job.status, 'failed')
  assert.ok(missing.job.errorMessage.includes('unavailable'))
})
test('claimed retries stay immediate after timezone changes and retain their original planned zone', () => {
  const h = harness('publication')
  h.state.channels.set('channel-1', { ...h.state.channels.get('channel-1'), status: 'disconnected' })
  h.tick()
  h.state.channels.set('channel-1', { ...h.state.channels.get('channel-1'), status: 'connected' })
  h.state.preferences = { ...h.state.preferences, timezone: 'America/New_York' }
  assert.equal(h.command('retry').ok, true)
  h.tick()
  assert.equal(h.job.status, 'running')
  assert.equal(h.job.queue.timezone, 'UTC')
  assert.doesNotThrow(() => serializeWorkspace(h.state))
})
test('a deliberately recreated schedule at the same wall time is distinct from its cancelled predecessor', () => {
  const h = harness('pipeline', '2030-01-01T11:00')
  h.tick()
  h.command('cancel')
  const item = h.state.content.get('queued-content')
  const outcome = executeOperation(h.state, { type: 'save', kind: 'content', mode: 'update', value: { ...item, status: 'Scheduled', scheduledAt: '2030-01-01T11:00', publishPreference: 'Schedule for a date' } }, new Date(h.now))
  assert.equal(outcome.result.ok, true)
  h.state = reconcileJobQueue(outcome.state, h.now)
  assert.equal(h.state.jobs.size, 2)
  assert.equal([...h.state.jobs.values()].filter(job => job.status === 'pending').length, 1)
  h.tick(3600000)
  assert.equal([...h.state.jobs.values()].filter(job => job.status === 'running').length, 1)
  assert.equal([...h.state.jobs.values()].filter(job => job.status === 'cancelled').length, 1)
})
test('unavailable native locks fall back to the guarded dispatcher', async () => {
  let runs = 0
  const denied = createQueueDispatcher({ run: () => { runs++ }, settled() {}, lock: () => Promise.reject(new Error('SecurityError')) })
  denied.tick()
  await new Promise(done => setImmediate(done))
  assert.equal(runs, 1)
  assert.equal(denied.busy, false)
  const throwing = createQueueDispatcher({ run: () => { runs++ }, settled() {}, lock: () => { throw new Error('SecurityError') } })
  throwing.tick()
  assert.equal(runs, 2)
  assert.equal(throwing.busy, false)
})
test('unexpected synchronous and asynchronous dispatcher errors are reported once and stop automatic work', async () => {
  for (const lock of [undefined, async work => work()]) {
    const errors = []
    let runs = 0
    const dispatcher = createQueueDispatcher({ run: () => { runs++; throw new Error('Unexpected worker failure') }, settled() { assert.fail('Failed work must not be rescheduled immediately') }, error: error => errors.push(error.message), lock })
    dispatcher.tick()
    await new Promise(done => setImmediate(done))
    assert.equal(dispatcher.failed, true)
    assert.equal(dispatcher.busy, false)
    assert.deepEqual(errors, ['Unexpected worker failure'])
    dispatcher.tick()
    assert.equal(runs, 1)
    dispatcher.dispose()
  }
})
test('errors in dispatcher completion and error-report callbacks cannot escape as asynchronous rejections', async () => {
  const dispatcher = createQueueDispatcher({ run() {}, settled() { throw new Error('Completion failed') }, error() { throw new Error('Reporter failed') }, lock: async work => work() })
  dispatcher.tick()
  await new Promise(done => setImmediate(done))
  assert.equal(dispatcher.failed, true)
  assert.equal(dispatcher.busy, false)
})
