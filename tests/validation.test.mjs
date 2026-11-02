import assert from 'node:assert/strict'
import test from 'node:test'
import { getMockInitialState } from '../src/state/mockData.ts'
import { executeOperation } from '../src/state/operations.ts'
import { canTransition, isDateTime, isTime, validateChannel, validateProvider, validatePipeline, validateContent, validateSchedule, validatePreferences, wallTimeNow } from '../src/state/validation.ts'

const instant = new Date('2026-10-06T10:00:00Z')
const future = '2099-10-07T10:00'
const content = () => ({ ...getMockInitialState().content.get('content-1'), id: 'new-content', title: 'A new idea', status: 'Idea', scheduledAt: '', publishPreference: 'Decide later' })
const channel = () => ({ ...getMockInitialState().channels.get('channel-3'), id: 'new-channel', name: 'New channel', handle: '@newchannel' })
const provider = () => ({ ...getMockInitialState().providers.get('provider-openai'), id: 'new-provider', name: 'Mock text service' })
const pipeline = () => ({ ...getMockInitialState().pipelines.get('pipeline-long-form'), id: 'new-pipeline', name: 'New pipeline' })
const save = (state, kind, value, mode = 'create', targetId) => executeOperation(state, { type: 'save', kind, value, mode, targetId }, instant)
const rejected = (outcome, state, key) => { assert.equal(outcome.state, state); assert.equal(outcome.result.ok, false); if (key) assert.ok(outcome.result.errors[key], key) }

test('seed channel, provider, pipeline and preferences configurations are valid', () => {
  const state = getMockInitialState()
  for (const value of state.channels.values()) assert.deepEqual(validateChannel(value, state), {})
  for (const value of state.providers.values()) assert.deepEqual(validateProvider(value, state), {})
  for (const value of state.pipelines.values()) assert.deepEqual(validatePipeline(value, state), {})
  assert.deepEqual(validatePreferences(state.preferences, state), {})
})
test('required fields, whitespace and length limits are rejected before a save', () => {
  const state = getMockInitialState()
  rejected(save(state, 'channel', { ...channel(), name: '  ', handle: '' }), state, 'name')
  rejected(save(state, 'provider', { ...provider(), name: '  ', models: [] }), state, 'models')
  rejected(save(state, 'pipeline', { ...pipeline(), name: 'x'.repeat(81) }), state, 'name')
  rejected(save(state, 'content', { ...content(), title: '  ', notes: 'x'.repeat(2001) }), state, 'title')
})
test('duplicate names are compared ignoring case and surrounding whitespace', () => {
  const state = getMockInitialState()
  rejected(save(state, 'channel', { ...channel(), name: ' creative GROWTH ' }), state, 'name')
  rejected(save(state, 'channel', { ...channel(), handle: ' @CREATIVEGROWTH ' }), state, 'handle')
  rejected(save(state, 'provider', { ...provider(), name: ' OPENAI ' }), state, 'name')
  rejected(save(state, 'pipeline', { ...pipeline(), name: ' Long-form video ' }), state, 'name')
  rejected(save(state, 'content', { ...content(), title: ' The 5-minute reset that changed my mornings ' }), state, 'title')
})
test('the same provider name may be configured for a different category', () => {
  const state = getMockInitialState()
  assert.equal(save(state, 'provider', { ...provider(), name: 'OpenAI', category: 'Text-to-speech', models: ['Mock TTS'] }).result.ok, true)
})
test('updating an item with its own name succeeds', () => {
  const state = getMockInitialState()
  for (const [kind, value] of [['channel', state.channels.get('channel-1')], ['provider', state.providers.get('provider-openai')], ['pipeline', state.pipelines.get('pipeline-long-form')], ['content', state.content.get('content-1')]]) assert.equal(save(state, kind, value, 'update').result.ok, true, kind)
})
test('duplicate IDs never overwrite existing data and update IDs cannot change', () => {
  const state = getMockInitialState()
  rejected(save(state, 'channel', { ...channel(), id: 'channel-1' }), state, 'id')
  rejected(save(state, 'provider', { ...provider(), id: 'provider-openai' }), state, 'id')
  rejected(save(state, 'content', { ...content(), id: 'content-1' }), state, 'id')
  rejected(save(state, 'pipeline', { ...pipeline(), id: 'pipeline-long-form' }), state, 'id')
  rejected(save(state, 'channel', channel(), 'update', 'channel-1'), state, 'id')
})
test('stale editors and deletions report operation failure without recreating records', () => {
  const state = getMockInitialState()
  const stale = save(state, 'channel', channel(), 'update')
  rejected(stale, state)
  assert.equal(stale.result.kind, 'failure')
  const missing = executeOperation(state, { type: 'delete', kind: 'content', id: 'missing' })
  rejected(missing, state)
  assert.match(missing.result.message, /no longer available/)
})
test('channel handle, publishing days, time and status rules are enforced', () => {
  const state = getMockInitialState()
  for (const [field, value] of [['handle', 'no-at'], ['handle', '@a'], ['scheduleDays', 'Monday, Monday'], ['scheduleDays', 'Someday'], ['scheduleTime', '25:61'], ['status', 'oauth-connected']]) assert.ok(validateChannel({ ...channel(), [field]: value }, state)[field])
  assert.ok(validateChannel({ ...channel(), scheduleDays: 'Monday', scheduleTime: '' }, state).scheduleTime)
})
test('invalid provider types, empty/duplicate models and credentials are rejected', () => {
  const state = getMockInitialState()
  assert.ok(validateProvider({ ...provider(), category: 'Real AI' }, state).category)
  assert.ok(validateProvider({ ...provider(), models: [' '] }, state).models)
  assert.ok(validateProvider({ ...provider(), models: ['Mock', ' mock '] }, state).models)
  const outcome = save(state, 'provider', { ...provider(), apiKey: 'secret-test-value' })
  rejected(outcome, state, 'configuration')
  assert.equal(JSON.stringify(outcome.result).includes('secret-test-value'), false)
})
test('missing or removed channel and pipeline selections are rejected', () => {
  const state = getMockInitialState()
  for (const field of ['channelId', 'pipelineId']) {
    assert.ok(validateContent({ ...content(), [field]: '' }, state)[field])
    assert.ok(validateContent({ ...content(), [field]: 'deleted-item' }, state)[field])
  }
  assert.ok(validateContent({ ...content(), pipelineId: 'pipeline-newsletter' }, state).pipelineId)
})
test('new content starts as Idea and status skips cannot be saved', () => {
  const state = getMockInitialState()
  assert.ok(validateContent({ ...content(), status: 'Published' }, state).status)
  const created = save(state, 'content', content())
  assert.equal(created.result.ok, true)
  rejected(save(created.state, 'content', { ...content(), status: 'Ready' }, 'update'), created.state, 'status')
  assert.equal(canTransition('Idea', 'Script'), true)
  assert.equal(canTransition('Published', 'Idea'), false)
  assert.equal(canTransition('Failed', 'Editing'), true)
  assert.equal(canTransition('invalid', 'Ready'), false)
})
test('valid content lifecycle and scheduled publishing synchronize shared state', () => {
  let state = save(getMockInitialState(), 'content', content()).state
  for (const status of ['Script', 'Generating', 'Editing', 'Ready', 'Scheduled', 'Published']) {
    const value = { ...state.content.get('new-content'), status, scheduledAt: status === 'Scheduled' ? future : '', publishPreference: status === 'Scheduled' ? 'Schedule for a date' : 'Publish manually when ready' }
    const outcome = save(state, 'content', value, 'update')
    assert.equal(outcome.result.ok, true, JSON.stringify(outcome.result))
    state = outcome.state
  }
  assert.equal(state.content.get('new-content').status, 'Published')
  assert.equal(Array.from(state.scheduledVideos.values()).some(s => s.contentId === 'new-content'), false)
})
test('published content cannot go backwards and metadata edits still work', () => {
  const state = getMockInitialState()
  rejected(save(state, 'content', { ...state.content.get('content-1'), status: 'Idea' }, 'update'), state, 'status')
  assert.equal(save(state, 'content', { ...state.content.get('content-1'), notes: 'Updated notes' }, 'update').result.ok, true)
})
test('calendar validation rejects rollover dates, bad times, partial and offset timestamps', () => {
  for (const value of ['2026-02-30T09:00', '2026-04-31T09:00', '2026-13-01T09:00', '2026-01-00T09:00', '2026-10-07T24:00', '2026-10-07T10:60', '2026-10-07', '2026-10-07T09:00Z', 'not-a-date']) assert.equal(isDateTime(value), false, value)
  assert.equal(isDateTime('2028-02-29T00:00'), true)
  assert.equal(isDateTime('2026-02-29T00:00'), false)
  for (const value of ['25:00', '10:60', '9:30', '', null]) assert.equal(isTime(value), false)
  assert.equal(isTime('23:59'), true)
})
test('past/new schedule times are checked against the workspace timezone', () => {
  const state = getMockInitialState()
  const item = { ...state.content.get('content-3'), scheduledAt: '', status: 'Ready' }
  state.content.set(item.id, item)
  assert.equal(wallTimeNow('Asia/Colombo', instant), '2026-10-06T15:30')
  for (const scheduledAt of ['2026-10-06T15:29', '2026-10-06T15:30', '2026-02-30T09:00', '']) assert.ok(validateContent({ ...item, status: 'Scheduled', publishPreference: 'Schedule for a date', scheduledAt }, state, instant).scheduledAt)
  assert.equal(validateContent({ ...item, status: 'Scheduled', publishPreference: 'Schedule for a date', scheduledAt: future }, state, instant).scheduledAt, undefined)
})
test('unchanged historical dates allow ordinary edits; newly chosen past dates do not', () => {
  const state = getMockInitialState()
  const schedule = { ...state.scheduledVideos.get('schedule-1'), scheduledAt: '2020-01-01T10:00' }
  state.scheduledVideos.set(schedule.id, schedule)
  state.content.set(schedule.contentId, { ...state.content.get(schedule.contentId), scheduledAt: schedule.scheduledAt })
  assert.equal(validateSchedule(schedule, state, instant).scheduledAt, undefined)
  assert.ok(validateSchedule({ ...schedule, scheduledAt: '2020-01-02T10:00' }, state, instant).scheduledAt)
})
test('schedule errors report missing content, broken links, duplicates and status skips', () => {
  const state = getMockInitialState()
  const schedule = { ...state.scheduledVideos.get('schedule-1'), scheduledAt: future }
  assert.ok(validateSchedule({ ...schedule, contentId: '' }, state, instant).contentId)
  assert.ok(validateSchedule({ ...schedule, id: 'duplicate' }, state, instant).contentId)
  assert.ok(validateSchedule({ ...schedule, contentId: 'content-1' }, state, instant).contentId)
  assert.ok(validateSchedule({ ...schedule, status: 'Processing' }, state, instant).status)
  state.content.set(schedule.contentId, { ...state.content.get(schedule.contentId), channelId: '', pipelineId: '' })
  const errors = validateSchedule(schedule, state, instant)
  assert.ok(errors.channelId); assert.ok(errors.pipelineId)
})
test('disconnected channels cannot schedule or publish', () => {
  const state = getMockInitialState()
  const item = { ...state.content.get('content-3'), status: 'Ready', scheduledAt: '', channelId: 'channel-3' }
  state.content.set(item.id, item)
  assert.ok(validateContent({ ...item, status: 'Published' }, state, instant).channelId)
  assert.ok(validateContent({ ...item, status: 'Scheduled', scheduledAt: future }, state, instant).channelId)
})
test('invalid pipelines reject missing steps, all-disabled flows and duplicate step IDs', () => {
  const state = getMockInitialState(), value = pipeline()
  assert.ok(validatePipeline({ ...value, steps: [] }, state).steps)
  assert.ok(validatePipeline({ ...value, steps: value.steps.map(s => ({ ...s, enabled: false })) }, state).steps)
  assert.deepEqual(validatePipeline({ ...value, enabled: false, steps: value.steps.map(s => ({ ...s, enabled: false })) }, state), {})
  assert.ok(validatePipeline({ ...value, steps: [value.steps[0], { ...value.steps[0], order: 1 }] }, state)['steps.1'])
})
test('pipeline ordering and unknown step kinds are validated', () => {
  const state = getMockInitialState(), value = pipeline()
  const reversed = [...value.steps].reverse().map((step, order) => ({ ...step, order }))
  assert.ok(validatePipeline({ ...value, steps: reversed }, state).steps)
  assert.ok(validatePipeline({ ...value, steps: [{ ...value.steps[0], kind: 'Magic' }] }, state)['steps.0.kind'])
  assert.ok(validatePipeline({ ...value, steps: [{ ...value.steps[0], order: 4 }] }, state)['steps.0.order'])
})
test('step providers must exist, support that step, and be enabled for active steps', () => {
  const state = getMockInitialState(), value = pipeline()
  const step = { ...value.steps[0], kind: 'Voice' }
  for (const providerId of ['missing', 'provider-openai', 'provider-elevenlabs']) assert.ok(validatePipeline({ ...value, steps: [{ ...step, config: { instructions: '', providerId } }] }, state)['steps.0.providerId'])
  state.providers.set('provider-elevenlabs', { ...state.providers.get('provider-elevenlabs'), enabled: true })
  assert.deepEqual(validatePipeline({ ...value, steps: [{ ...step, config: { instructions: '', providerId: 'provider-elevenlabs' } }] }, state), {})
})
test('pipeline channel assignments and instruction limits are checked', () => {
  const state = getMockInitialState(), value = pipeline()
  assert.ok(validatePipeline({ ...value, assignedChannelIds: ['deleted'] }, state).assignedChannelIds)
  assert.ok(validatePipeline({ ...value, assignedChannelIds: ['channel-1', 'channel-1'] }, state).assignedChannelIds)
  assert.ok(validatePipeline({ ...value, steps: [{ ...value.steps[0], config: { instructions: 'x'.repeat(2001), providerId: null } }] }, state)['steps.0.instructions'])
})
test('invalid preferences cannot replace saved settings', () => {
  const state = getMockInitialState()
  const outcome = executeOperation(state, { type: 'preferences', value: { ...state.preferences, workspaceName: ' ', timezone: 'Missing/Zone', defaultPublishTime: '24:01', language: 'invalid', defaultChannelId: 'missing', defaultPipelineId: 'pipeline-newsletter', voiceProviderId: 'provider-openai' } })
  rejected(outcome, state)
  for (const key of ['workspaceName', 'timezone', 'defaultPublishTime', 'language', 'defaultChannelId', 'defaultPipelineId', 'voiceProviderId']) assert.ok(outcome.result.errors[key], key)
})
test('disabling providers and pipelines clears unusable defaults', () => {
  const state = getMockInitialState()
  const disabledProvider = save(state, 'provider', { ...state.providers.get('provider-openai'), enabled: false }, 'update')
  assert.equal(disabledProvider.result.ok, true); assert.equal(disabledProvider.state.preferences.textProviderId, null)
  const disabledPipeline = save(state, 'pipeline', { ...state.pipelines.get('pipeline-long-form'), enabled: false }, 'update')
  assert.equal(disabledPipeline.result.ok, true); assert.equal(disabledPipeline.state.preferences.defaultPipelineId, null)
})
test('channel deletion with assigned content reports a recoverable validation error', () => {
  const state = getMockInitialState()
  const outcome = executeOperation(state, { type: 'delete', kind: 'channel', id: 'channel-1' })
  rejected(outcome, state, 'channel')
  assert.match(outcome.result.errors.channel, /Reassign or delete/)
})
test('unexpected exceptions produce safe operation failures and preserve previous data', () => {
  const state = getMockInitialState()
  const value = provider()
  Object.defineProperty(value, 'name', { get() { throw new Error('Sensitive stack trace and internal-service-secret') } })
  const outcome = save(state, 'provider', value)
  rejected(outcome, state)
  assert.equal(outcome.result.kind, 'failure')
  assert.equal(JSON.stringify(outcome.result).includes('internal-service-secret'), false)
  assert.equal(JSON.stringify(outcome.result).includes('stack trace'), false)
})

test('invalid pipeline dependencies cannot be selected for new content', () => {
  const state = getMockInitialState()
  const flow = state.pipelines.get('pipeline-long-form')
  state.pipelines.set(flow.id, { ...flow, steps: flow.steps.map(step => step.kind === 'Voice' ? { ...step, config: { ...step.config, providerId: 'provider-elevenlabs' } } : step) })
  rejected(save(state, 'content', content()), state, 'pipelineId')
})
test('creating schedules requires ready content, and duplicate schedule IDs cannot overwrite', () => {
  const state = getMockInitialState()
  const item = content()
  state.content.set(item.id, item)
  const schedule = { ...state.scheduledVideos.get('schedule-1'), id: 'new-schedule', contentId: item.id, scheduledAt: future }
  rejected(save(state, 'schedule', schedule), state, 'contentId')
  rejected(save(state, 'schedule', { ...schedule, id: 'schedule-1' }), state, 'id')
})
test('an enabled pipeline with no active steps cannot be toggled on', () => {
  const state = getMockInitialState()
  const flow = { ...pipeline(), enabled: false, steps: pipeline().steps.map(step => ({ ...step, enabled: false })) }
  const created = save(state, 'pipeline', flow)
  assert.equal(created.result.ok, true)
  rejected(save(created.state, 'pipeline', { ...flow, enabled: true }, 'update'), created.state, 'steps')
})
