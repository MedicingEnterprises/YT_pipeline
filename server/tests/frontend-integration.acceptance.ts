import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { buildApp } from '../src/app.js'
import { loadConfig } from '../src/config/env.js'
import { databaseFixture } from './database.fixture.js'
import { createApiClient, ApiError } from '../../src/api/client.ts'
import { fetchWorkspace, wallToInstant, writeBody } from '../../src/api/workspace.ts'
import { prepareImport } from '../../src/api/import.ts'
import { serializeWorkspace } from '../../src/state/persistence.ts'
import { createWorkflowHarness } from '../../tests/workflow.fixture.mjs'

const fixture = await databaseFixture()
const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://localhost/unused', LOG_LEVEL: 'error', SESSION_SECRET: randomBytes(32).toString('base64url') })
const app = buildApp(config, { database: fixture.database })
let requests = 0, unauthorized = 0
function client(ip: string) {
  const cookies = new Map<string, string>()
  const transport: typeof fetch = async (url, options = {}) => {
    assert.equal(options.credentials, 'include')
    const path = String(url)
    assert.ok(path.startsWith('/'))
    const headers = Object.fromEntries(new Headers(options.headers).entries())
    headers.cookie = [...cookies].map(([key, value]) => `${key}=${value}`).join('; ')
    const reply = await app.inject({ method: options.method as 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: path, headers, remoteAddress: ip, ...(options.body ? { payload: String(options.body) } : {}) })
    for (const cookie of reply.cookies) { if (cookie.value) cookies.set(cookie.name, cookie.value); else cookies.delete(cookie.name) }
    requests++
    return new Response(reply.statusCode === 204 ? null : reply.body, { status: reply.statusCode, headers: { 'Content-Type': 'application/json' } })
  }
  return createApiClient({ fetch: transport, unauthorized: () => unauthorized++ })
}
try {
  const api = client('192.0.2.31')
  await assert.rejects(api.request('/api/v1/workspace'), (error: unknown) => error instanceof ApiError && error.status === 401)
  assert.equal(unauthorized, 1)
  await api.request('/api/v1/auth/register', 'POST', { email: 'integration@example.invalid', displayName: 'Integration', password: 'Disposable integration password 1!' }); api.invalidateCsrf()
  let state = await fetchWorkspace(api)
  assert.equal(state.channels.size, 0)
  const channel = (await api.request<{data: any}>('/api/v1/channels', 'POST', { name: 'API channel', handle: '@apichannel', status: 'CONNECTED' })).data
  const provider = (await api.request<{data: any}>('/api/v1/ai-providers', 'POST', { name: 'API provider', category: 'TEXT_GENERATION', models: ['mock'] })).data
  const pipeline = (await api.request<{data: any}>('/api/v1/pipelines', 'POST', { name: 'API pipeline', assignedChannelIds: [channel.id], steps: [{ kind: 'SCRIPT', order: 0, providerId: provider.id }, { kind: 'SCHEDULE', order: 1 }] })).data
  const content = (await api.request<{data: any}>('/api/v1/content', 'POST', { title: 'API idea', channelId: channel.id, pipelineId: pipeline.id })).data
  state = await fetchWorkspace(api)
  assert.equal(state.providers.get(provider.id)!.category, 'Text generation')
  assert.equal(state.pipelines.get(pipeline.id)!.steps[1]!.kind, 'Schedule')
  const configuration = writeBody('pipeline', { ...state.pipelines.get(pipeline.id)!, steps: [...state.pipelines.get(pipeline.id)!.steps, { id: 'new-local-step', kind: 'Review', enabled: true, order: 2, config: { providerId: null, instructions: 'Review' } }] }, state, true)
  await api.request(`/api/v1/pipelines/${pipeline.id}/configuration`, 'PUT', configuration)
  state = await fetchWorkspace(api)
  assert.equal(state.pipelines.get(pipeline.id)!.steps.length, 3)
  assert.equal(state.pipelines.get(pipeline.id)!.steps[0]!.id, pipeline.steps[0].id)
  assert.notEqual(state.pipelines.get(pipeline.id)!.steps[2]!.id, 'new-local-step')
  const brokenConfiguration = { ...configuration, steps: [...configuration.steps, { kind: 'VOICE', enabled: true, order: 3, providerId: provider.id }] }
  await assert.rejects(api.request(`/api/v1/pipelines/${pipeline.id}/configuration`, 'PUT', brokenConfiguration))
  assert.equal((await fetchWorkspace(api)).pipelines.get(pipeline.id)!.steps.length, 3)
  for (const status of ['SCRIPT', 'GENERATING', 'EDITING', 'READY']) await api.request(`/api/v1/content/${content.id}`, 'PATCH', { status })
  await api.request('/api/v1/preferences', 'PATCH', { timezone: 'Asia/Kolkata' })
  state = await fetchWorkspace(api)
  const schedule = writeBody('schedule', { contentId: content.id, scheduledAt: '2099-01-01T15:30', executionMode: 'publication' }, state)
  assert.equal(schedule.scheduledAt, '2099-01-01T10:00:00.000Z')
  await api.request('/api/v1/schedules', 'POST', schedule)
  state = await fetchWorkspace(api)
  assert.equal(state.content.get(content.id)!.status, 'Scheduled')
  assert.equal([...state.scheduledVideos.values()][0]!.scheduledAt, '2099-01-01T15:30')
  assert.equal([...state.jobs.values()][0]!.queue!.type, 'SCHEDULED_PUBLICATION')
  assert.equal(wallToInstant('2099-01-01T15:45', 'Asia/Kathmandu'), '2099-01-01T10:00:00.000Z')
  assert.throws(() => wallToInstant('2030-03-10T02:30', 'America/New_York'))
  assert.throws(() => wallToInstant('2030-11-03T01:30', 'America/New_York'))
  assert.throws(() => prepareImport('{broken'))
  const h = createWorkflowHarness(); h.start(); h.finishPreparation()
  h.operation({ type: 'save', kind: 'schedule', mode: 'create', value: { id: 'imported-schedule', contentId: h.item.id, channelId: h.item.channelId, pipelineId: h.item.pipelineId, title: h.item.title, thumbnail: h.item.thumbnail, status: 'Scheduled', scheduledAt: '2099-01-02T15:30', createdAt: new Date(h.now).toISOString(), updatedAt: new Date(h.now).toISOString() } })
  const raw = serializeWorkspace(h.state)
  const payload = prepareImport(raw)
  const preview = (await api.request<{data:any}>('/api/v1/workspace/import/preview', 'POST', payload)).data
  assert.equal(preview.alreadyImported, false)
  const imported = (await api.request<{data:any}>('/api/v1/workspace/import', 'POST', payload)).data
  assert.equal(imported.digest, preview.digest)
  state = await fetchWorkspace(api)
  assert.equal(state.channels.size, 2)
  assert.equal(state.preferences!.timezone, 'Asia/Kolkata')
  const restored = [...state.content.values()].find(item => item.title === h.item.title)!
  assert.notEqual(restored.id, h.item.id)
  assert.ok(state.channels.has(restored.channelId)); assert.ok(state.pipelines.has(restored.pipelineId))
  assert.ok([...state.scheduledVideos.values()].some(item => item.contentId === restored.id))
  const originalMessages = h.run.queue.history.map((event: { message: string }) => event.message)
  assert.ok(originalMessages.length > 0)
  assert.ok([...state.jobs.values()].some(job => job.contentId === restored.id && originalMessages.every((message: string) => job.queue!.history.some(event => event.message === message))), 'Original queue history is retained')
  await assert.rejects(api.request('/api/v1/workspace/import', 'POST', payload), (error: unknown) => error instanceof ApiError && error.status === 409)
  assert.equal((await api.request<{data:any}>('/api/v1/workspace/import/preview', 'POST', { ...payload, channels: [...payload.channels].reverse() })).data.alreadyImported, true)
  const invalid = structuredClone(payload)
  invalid.channels[0].name = 'Rollback channel'; invalid.channels[0].handle = '@rollback'
  invalid.providers[0].name = 'Rollback provider'; invalid.pipelines[0].name = 'Rollback pipeline'; invalid.pipelines[0].steps[0].providerId = 'missing-provider'
  await assert.rejects(api.request('/api/v1/workspace/import', 'POST', invalid))
  assert.equal((await fetchWorkspace(api)).channels.size, 2, 'Import failure rolls back records created before the bad reference')
  assert.equal(serializeWorkspace(h.state), raw, 'Conversion/import does not mutate the source backup')
  const second = client('192.0.2.32')
  await second.request('/api/v1/auth/register', 'POST', { email: 'second-integration@example.invalid', displayName: 'Second', password: 'Disposable integration password 2!' }); second.invalidateCsrf()
  assert.equal((await fetchWorkspace(second)).channels.size, 0)
  await second.request('/api/v1/workspace/import', 'POST', prepareImport(raw, true))
  assert.equal((await fetchWorkspace(second)).preferences!.workspaceName, h.state.preferences.workspaceName)
  await assert.rejects(api.request('/api/v1/workspace/reset', 'POST', { confirmation: 'WRONG' }))
  await api.request('/api/v1/workspace/reset', 'POST', { confirmation: 'RESET' })
  assert.equal((await fetchWorkspace(api)).channels.size, 0)
  assert.equal((await fetchWorkspace(second)).channels.size, 1)
  await assert.rejects(api.request('/api/v1/workspace/import', 'POST', payload), (error: unknown) => error instanceof ApiError && error.status === 409)
  await api.request('/api/v1/auth/logout', 'POST'); api.invalidateCsrf()
  await assert.rejects(api.request('/api/v1/workspace'), (error: unknown) => error instanceof ApiError && error.status === 401)
  assert.equal(unauthorized, 2)
  console.log(`Frontend/backend integration passed: ${requests} HTTP requests; auth/CSRF, DTOs, atomic configuration, timezones, imports, rollback, ownership and reset.`)
} finally { await app.close(); await fixture.close() }
