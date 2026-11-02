import assert from 'node:assert/strict'
import test from 'node:test'
import { getMockInitialState } from '../src/state/mockData.ts'
import { saveContent, saveSchedule, removeContent, removeSchedule, removePipeline, removeProvider, removeChannel } from '../src/state/mutations.ts'

const makeContent = () => ({ ...getMockInitialState().content.get('content-1'), id: 'test-content', title: 'New mock idea', status: 'Idea', scheduledAt: '', publishPreference: 'Decide later' })
const makeSchedule = contentId => ({ id: 'test-schedule', contentId, title: 'Stale title', thumbnail: '', channelId: '', pipelineId: '', scheduledAt: '2027-01-14T09:30', status: 'Scheduled', createdAt: '', updatedAt: '' })

test('fixtures use consistent linked content and schedule metadata', () => {
  const state = getMockInitialState()
  for (const schedule of state.scheduledVideos.values()) {
    const content = state.content.get(schedule.contentId)
    assert.equal(schedule.title, content.title)
    assert.equal(schedule.channelId, content.channelId)
    assert.equal(schedule.pipelineId, content.pipelineId)
    assert.equal(schedule.scheduledAt, content.scheduledAt)
  }
})

test('creating and editing content updates shared records without mutating previous state', () => {
  const original = getMockInitialState()
  let state = saveContent(original, makeContent())
  assert.equal(state.content.size, original.content.size + 1)
  assert.equal(original.content.has('test-content'), false)
  state = saveContent(state, { ...state.content.get('test-content'), title: 'Edited', channelId: 'channel-2', pipelineId: 'pipeline-shorts', status: 'Scheduled', scheduledAt: '2027-01-14T09:30', publishPreference: 'Schedule for a date' })
  const schedule = Array.from(state.scheduledVideos.values()).find(item => item.contentId === 'test-content')
  assert.equal(schedule.title, 'Edited')
  assert.equal(schedule.channelId, 'channel-2')
  assert.equal(schedule.pipelineId, 'pipeline-shorts')
  assert.equal(state.content.get('test-content').status, 'Scheduled')
})

test('schedule creation, rescheduling and status changes update content', () => {
  let state = saveContent(getMockInitialState(), makeContent())
  state = saveSchedule(state, makeSchedule('test-content'))
  assert.equal(state.content.get('test-content').scheduledAt, '2027-01-14T09:30')
  assert.equal(state.scheduledVideos.get('test-schedule').title, 'New mock idea')
  for (const [status, expected] of [['Ready', 'Ready'], ['Processing', 'Generating'], ['Needs attention', 'Failed'], ['Scheduled', 'Scheduled']]) {
    state = saveSchedule(state, { ...state.scheduledVideos.get('test-schedule'), status, scheduledAt: '2027-02-01T10:15' })
    assert.equal(state.content.get('test-content').status, expected)
    assert.equal(state.content.get('test-content').scheduledAt, '2027-02-01T10:15')
  }
})

test('reassigning a schedule clears its previous content date', () => {
  let state = saveContent(getMockInitialState(), makeContent())
  state = saveSchedule(state, { ...state.scheduledVideos.get('schedule-1'), contentId: 'test-content' })
  assert.equal(state.content.get('content-2').scheduledAt, '')
  assert.equal(state.content.get('content-2').status, 'Ready')
  assert.equal(state.scheduledVideos.get('schedule-1').contentId, 'test-content')
})

test('one schedule per content item and invalid schedules are rejected', () => {
  let state = saveContent(getMockInitialState(), makeContent())
  state = saveSchedule(state, makeSchedule('test-content'))
  state = saveSchedule(state, { ...makeSchedule('test-content'), id: 'replacement' })
  assert.equal(Array.from(state.scheduledVideos.values()).filter(s => s.contentId === 'test-content').length, 1)
  assert.equal(saveSchedule(state, makeSchedule('missing')), state)
  assert.equal(saveSchedule(state, { ...makeSchedule('test-content'), scheduledAt: 'invalid' }), state)
})

test('content metadata edits propagate to existing schedules and analytics', () => {
  const state = saveContent(getMockInitialState(), { ...getMockInitialState().content.get('content-2'), title: 'Renamed', channelId: 'channel-3', pipelineId: 'pipeline-newsletter' })
  assert.equal(state.scheduledVideos.get('schedule-1').title, 'Renamed')
  assert.equal(state.analytics.get('analytics-2').title, 'Renamed')
  assert.equal(state.analytics.get('analytics-2').channelId, 'channel-3')
})

test('publishing mock content removes pending schedule without performing an upload', () => {
  const initial = getMockInitialState()
  const state = saveContent(initial, { ...initial.content.get('content-2'), status: 'Published' })
  assert.equal(state.content.get('content-2').scheduledAt, '')
  assert.equal(state.scheduledVideos.has('schedule-1'), false)
})

test('deleting schedules clears dates and returns scheduled content to Ready', () => {
  const state = removeSchedule(getMockInitialState(), 'schedule-1')
  assert.equal(state.scheduledVideos.has('schedule-1'), false)
  assert.equal(state.content.get('content-2').scheduledAt, '')
  assert.equal(state.content.get('content-2').status, 'Ready')
})

test('deleting content cleans dependent schedules, jobs, analytics and selections', () => {
  const initial = getMockInitialState()
  initial.selectedContentId = 'content-2'
  initial.jobs.set('job', { contentId: 'content-2' })
  const state = removeContent(initial, 'content-2')
  assert.equal(state.content.has('content-2'), false)
  assert.equal(state.scheduledVideos.has('schedule-1'), false)
  assert.equal(state.analytics.has('analytics-2'), false)
  assert.equal(state.jobs.has('job'), false)
  assert.equal(state.selectedContentId, null)
})

test('deleting a pipeline detaches references while retaining content', () => {
  const initial = getMockInitialState()
  const state = removePipeline(initial, 'pipeline-long-form')
  assert.equal(state.content.size, initial.content.size)
  assert.equal(state.content.get('content-1').pipelineId, '')
  assert.equal(state.channels.get('channel-1').defaultPipelineId, null)
  assert.equal(state.preferences.defaultPipelineId, null)
  assert.equal(Array.from(state.scheduledVideos.values()).some(s => s.pipelineId === 'pipeline-long-form'), false)
})

test('deleting a provider clears step assignments and preference defaults', () => {
  const initial = getMockInitialState()
  const pipeline = initial.pipelines.get('pipeline-long-form')
  initial.pipelines.set(pipeline.id, { ...pipeline, steps: pipeline.steps.map(s => ({ ...s, config: { ...s.config, providerId: 'provider-openai' } })) })
  const state = removeProvider(initial, 'provider-openai')
  assert.equal(state.providers.has('provider-openai'), false)
  assert.equal(state.preferences.textProviderId, null)
  assert.equal(state.pipelines.get(pipeline.id).steps.every(s => s.config.providerId === null), true)
})

test('channel deletion protects assigned content and cleans empty channel references', () => {
  const initial = getMockInitialState()
  assert.equal(removeChannel(initial, 'channel-1'), initial)
  const state = removeChannel(initial, 'channel-3')
  assert.equal(state.channels.has('channel-3'), false)
  assert.equal(initial.channels.has('channel-3'), true)
})

test('notification preferences control new mock activity', () => {
  const initial = getMockInitialState()
  const silent = { ...initial, preferences: { ...initial.preferences, notifyPipeline: false } }
  const saved = saveContent(silent, makeContent())
  assert.equal(saved.activities.length, initial.activities.length)
  const announced = saveContent(initial, makeContent())
  assert.equal(announced.activities[0].relatedContentId, 'test-content')
  assert.equal(announced.activities[0].title, 'Content created')
})
