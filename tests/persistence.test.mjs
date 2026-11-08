import assert from 'node:assert/strict'
import test from 'node:test'
import { WORKSPACE_KEY, WORKSPACE_VERSION, serializeWorkspace, deserializeWorkspace, createWorkspaceSession } from '../src/state/persistence.ts'
import { getMockInitialState } from '../src/state/mockData.ts'
import { executeOperation } from '../src/state/operations.ts'

function memoryStorage(initial = null) {
  let raw = initial
  let writes = 0
  return { getItem(key) { assert.equal(key, WORKSPACE_KEY); return raw }, setItem(key, value) { assert.equal(key, WORKSPACE_KEY); raw = value; writes++ }, get raw() { return raw }, get writes() { return writes } }
}
const keys = ['channels', 'providers', 'content', 'pipelines', 'scheduledVideos', 'jobs', 'analytics']
test('all collections, nested steps, preferences, activities and job metadata round-trip as Maps', () => {
  const state = getMockInitialState()
  state.jobs.set('job-test', { id: 'job-test', contentId: 'content-1', pipelineStepId: 'historical-step', kind: 'script_generation', status: 'completed', providerId: null, startedAt: null, completedAt: null, errorMessage: null, metadata: { output: { words: 32 }, attempts: [1, 2] }, createdAt: '', updatedAt: '' })
  state.selectedChannelId = 'channel-1'
  const serialized = serializeWorkspace(state)
  const envelope = JSON.parse(serialized)
  assert.equal(envelope.version, WORKSPACE_VERSION)
  for (const key of keys) assert.ok(Array.isArray(envelope.workspace[key]))
  const restored = deserializeWorkspace(serialized)
  for (const key of keys) { assert.ok(restored[key] instanceof Map); assert.deepEqual(restored[key], state[key]) }
  assert.deepEqual(restored.preferences, state.preferences)
  assert.deepEqual(restored.activities, state.activities)
  assert.equal(restored.selectedChannelId, null)
})
test('first run seeds once, and refresh restores edits rather than reintroducing demo data', () => {
  const storage = memoryStorage()
  const first = createWorkspaceSession(() => storage)
  assert.equal(first.status.kind, 'first-run')
  assert.equal(storage.writes, 0, 'initialization must not write during React render')
  assert.equal(first.save(first.state).kind, 'saved')
  const result = executeOperation(first.state, { type: 'save', kind: 'channel', mode: 'update', value: { ...first.state.channels.get('channel-1'), name: 'Restored custom name' } })
  assert.equal(result.result.ok, true)
  first.save(result.state)
  const refresh = createWorkspaceSession(() => storage)
  assert.equal(refresh.status.kind, 'saved')
  assert.equal(refresh.state.channels.get('channel-1').name, 'Restored custom name')
  refresh.save(refresh.state)
  assert.equal(storage.writes, 2, 'mounting restored data must not rewrite it')
})
test('explicit allowlists exclude UI state and provider credentials on save and restore', () => {
  const state = getMockInitialState()
  state.dialog = 'open'
  state.draft = 'secret draft'
  state.providers = new Map(state.providers)
  const provider = state.providers.get('provider-openai')
  state.providers.set(provider.id, { ...provider, apiKey: 'secret', accessToken: 'secret' })
  const raw = serializeWorkspace(state)
  assert.ok(!raw.includes('secret'))
  assert.ok(!raw.includes('selectedChannelId'))
  assert.ok(!raw.includes('dialog'))
  const envelope = JSON.parse(raw)
  envelope.workspace.providers[0].apiKey = 'injected'
  const restored = deserializeWorkspace(JSON.stringify(envelope))
  assert.ok(!('apiKey' in restored.providers.values().next().value))
})
test('malformed, incomplete, duplicate, invalid nested fields and unsupported snapshots are preserved', () => {
  const base = serializeWorkspace(getMockInitialState())
  const change = fn => { const data = JSON.parse(base); fn(data); return JSON.stringify(data) }
  for (const [raw, kind] of [
    ['{broken', 'invalid'], ['null', 'invalid'], ['{}', 'invalid'],
    [change(data => { delete data.workspace.channels }), 'invalid'],
    [change(data => { delete data.workspace.preferences.timezone }), 'invalid'],
    [change(data => { data.workspace.pipelines[0].steps[0].config = null }), 'invalid'],
    [change(data => { data.workspace.channels.push(data.workspace.channels[0]) }), 'invalid'],
    [change(data => { data.workspace.channels[0].status = 'made-up' }), 'invalid'],
    [change(data => { data.workspace.content[0].channelId = 'missing' }), 'invalid'],
    [change(data => { data.workspace.scheduledVideos[0].scheduledAt = '2027-02-30T09:30' }), 'invalid'],
    [change(data => { data.version = WORKSPACE_VERSION + 1 }), 'unsupported'],
    [change(data => { data.version = 0 }), 'unsupported'],
  ]) {
    const storage = memoryStorage(raw)
    const session = createWorkspaceSession(() => storage)
    assert.equal(session.status.kind, kind)
    assert.equal(session.save(session.state).kind, kind)
    assert.equal(session.retry(session.state).kind, kind)
    assert.equal(storage.raw, raw)
    assert.equal(storage.writes, 0)
  }
})
test('quota and unavailable storage do not throw, destroy saved data or lose in-memory changes', () => {
  const storage = memoryStorage(serializeWorkspace(getMockInitialState()))
  let fail = true
  const adapter = { getItem: storage.getItem, setItem(key, raw) { if (fail) throw new Error('QuotaExceededError'); storage.setItem(key, raw) } }
  const session = createWorkspaceSession(() => adapter)
  const next = { ...session.state, preferences: { ...session.state.preferences, workspaceName: 'Unsaved work' } }
  assert.equal(session.save(next).kind, 'write-error')
  assert.equal(deserializeWorkspace(storage.raw).preferences.workspaceName, 'Northstar Studio')
  fail = false
  assert.equal(session.retry(next).kind, 'saved')
  assert.equal(createWorkspaceSession(() => storage).state.preferences.workspaceName, 'Unsaved work')
  const inaccessible = createWorkspaceSession(() => { throw new Error('SecurityError') })
  assert.equal(inaccessible.status.kind, 'unavailable')
  assert.equal(inaccessible.save(inaccessible.state).kind, 'unavailable')
  assert.equal(inaccessible.retry(inaccessible.state).kind, 'write-error')
})
test('a failed initial read never permits overwriting an existing saved workspace on retry', () => {
  const storage = memoryStorage(serializeWorkspace(getMockInitialState()))
  let fail = true
  const session = createWorkspaceSession(() => { if (fail) throw new Error('SecurityError'); return storage })
  fail = false
  assert.equal(session.retry(session.state).kind, 'conflict')
  assert.equal(storage.writes, 0)
})
test('reset replaces even invalid data with a durable empty workspace and retained usable defaults', () => {
  const storage = memoryStorage('invalid snapshot')
  const session = createWorkspaceSession(() => storage)
  const reset = session.reset()
  assert.equal(reset.status.kind, 'saved')
  for (const key of keys) assert.equal(reset.state[key].size, 0)
  const refreshed = createWorkspaceSession(() => storage)
  for (const key of keys) assert.equal(refreshed.state[key].size, 0)
  assert.equal(refreshed.state.preferences.defaultChannelId, null)
  assert.deepEqual(refreshed.state.activities, [])
})
test('reset failures keep the saved snapshot and return no replacement state', () => {
  const raw = serializeWorkspace(getMockInitialState())
  const session = createWorkspaceSession(() => ({ getItem: () => raw, setItem() { throw new Error('QuotaExceededError') } }))
  assert.equal(session.reset().state, null)
  assert.equal(session.status.kind, 'write-error')
})
test('another tab changing storage is protected from stale writes', () => {
  const storage = memoryStorage()
  const first = createWorkspaceSession(() => storage)
  first.save(first.state)
  const second = createWorkspaceSession(() => storage)
  second.save({ ...second.state, preferences: { ...second.state.preferences, workspaceName: 'Other tab' } })
  assert.equal(first.save(first.state).kind, 'conflict')
  assert.equal(createWorkspaceSession(() => storage).state.preferences.workspaceName, 'Other tab')
})
test('deleted pipeline links and disabled dependencies restore without replaying creation rules', () => {
  let state = getMockInitialState()
  state = executeOperation(state, { type: 'delete', kind: 'pipeline', id: 'pipeline-long-form' }).state
  state = executeOperation(state, { type: 'save', kind: 'provider', mode: 'update', value: { ...state.providers.get('provider-openai'), enabled: false } }).state
  assert.equal(serializeWorkspace(deserializeWorkspace(serializeWorkspace(state))), serializeWorkspace(state))
})
test('historical schedules remain unchanged and scheduled processing content can advance to Editing', () => {
  let state = getMockInitialState()
  const item = state.content.get('content-5')
  const outcome = executeOperation(state, { type: 'save', kind: 'content', mode: 'update', value: { ...item, status: 'Editing' } })
  assert.equal(outcome.result.ok, true)
  state = outcome.state
  const schedule = [...state.scheduledVideos.values()].find(row => row.contentId === item.id)
  state.content.set(item.id, { ...state.content.get(item.id), scheduledAt: '2001-01-01T09:30' })
  state.scheduledVideos.set(schedule.id, { ...schedule, scheduledAt: '2001-01-01T09:30' })
  const restored = deserializeWorkspace(serializeWorkspace(state))
  assert.equal(restored.content.get(item.id).status, 'Editing')
  assert.equal(restored.scheduledVideos.get(schedule.id).scheduledAt, '2001-01-01T09:30')
})
test('storage read failures recover on retry when no previous saved workspace exists', () => {
  const storage = memoryStorage()
  let fail = true
  const adapter = { getItem(key) { if (fail) throw new Error('SecurityError'); return storage.getItem(key) }, setItem: storage.setItem }
  const session = createWorkspaceSession(() => adapter)
  assert.equal(session.status.kind, 'unavailable')
  fail = false
  assert.equal(session.retry(session.state).kind, 'saved')
  assert.equal(createWorkspaceSession(() => storage).status.kind, 'saved')
})
