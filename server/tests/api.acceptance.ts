/** Focused API/Prisma acceptance check. Uses the pinned development-only PGlite
 * dependency, never a configured or external database.
 * Run from server: node --import tsx tests/api.acceptance.ts
 * This is single-connection SQL verification, not a production concurrency test.
 */
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { buildApp } from '../src/app.js'
import { loadConfig } from '../src/config/env.js'
import { AuthService } from '../src/services/auth.service.js'
import { hashPassword } from '../src/services/password.service.js'
import { cookieNames } from '../src/middleware/session.js'
import { databaseFixture } from './database.fixture.js'

const fixture = await databaseFixture()
const { database } = fixture
const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://localhost/unused', LOG_LEVEL: 'error', SESSION_SECRET: randomBytes(32).toString('base64url') })
const auth = new AuthService(database, config)
const credentials = new Map<string, { cookie: string; csrf: string }>()
let identity: string | null = null
const app = buildApp(config, { database })
const closedApp = buildApp({ ...config, nodeEnv: 'production', secureCookies: true }, { database })
const first = '00000000-0000-4000-8000-000000000001'
const second = '00000000-0000-4000-8000-000000000002'
let checks = 0
async function call(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: object, status = 200) {
  const session = identity ? credentials.get(identity) : undefined
  const reply = await app.inject({ method, url, ...(payload ? { payload } : {}), headers: session ? { cookie: session.cookie, 'x-csrf-token': session.csrf } : {} })
  assert.equal(reply.statusCode, status, `${method} ${url}: ${reply.body}`)
  checks++
  return status === 204 ? null : reply.json()
}
async function otherOwner(resource: string, id: string, readOnly = false) {
  identity = second
  await call('GET', `/api/v1/${resource}/${id}`, undefined, 404)
  if (!readOnly) await call('DELETE', `/api/v1/${resource}/${id}`, undefined, 404)
  identity = first
}
try {
  const password = 'Only a disposable test password 129!'
  const passwordHash = await hashPassword(password)
  await database.user.createMany({ data: [{ id: first, email: 'first@example.invalid', displayName: 'First', passwordHash }, { id: second, email: 'second@example.invalid', displayName: 'Second', passwordHash }] })
  await database.userPreferences.createMany({ data: [{ userId: first, language: 'en-US' }, { userId: second, language: 'en-US' }] })
  for (const [id, email] of [[first, 'first@example.invalid'], [second, 'second@example.invalid']]) {
    const issued = await auth.login(email!, password)
    credentials.set(id!, { cookie: `${cookieNames(config).session}=${issued.token}`, csrf: auth.csrf(issued.token) })
  }
  await call('GET', '/health')
  const spec = await call('GET', '/openapi.json')
  assert.equal(spec.openapi, '3.1.0')
  assert.ok(spec.paths['/api/v1/jobs/{id}/history'])
  await call('GET', '/api/v1/channels', undefined, 401)
  assert.equal((await closedApp.inject({ url: '/api/v1/channels', headers: { 'x-user-id': first, authorization: 'Bearer fake' } })).statusCode, 401)
  identity = first
  await call('POST', '/api/v1/channels', { name: 'A', handle: '@channel', userId: second }, 400)
  await call('POST', '/api/v1/ai-providers', { name: 'Bad', category: 'TEXT_GENERATION', models: ['mock'], apiKey: 'not-accepted' }, 400)
  await call('GET', '/api/v1/channels?sort=password', undefined, 400)
  await call('GET', '/api/v1/jobs?status=INVALID', undefined, 400)
  await call('GET', '/api/v1/content/not-a-uuid', undefined, 400)
  const channel = (await call('POST', '/api/v1/channels', { name: 'Channel', handle: '@channel', status: 'CONNECTED' }, 201)).data
  const provider = (await call('POST', '/api/v1/ai-providers', { name: 'Mock', category: 'TEXT_GENERATION', models: ['mock-text'] }, 201)).data
  const pipeline = (await call('POST', '/api/v1/pipelines', { name: 'Pipeline', assignedChannelIds: [channel.id], steps: [{ kind: 'IDEA', order: 0 }, { kind: 'SCRIPT', order: 1, providerId: provider.id }] }, 201)).data
  assert.equal(pipeline.steps.length, 2)
  assert.deepEqual(pipeline.assignedChannelIds, [channel.id])
  await call('POST', '/api/v1/pipelines', { name: 'Invalid order', steps: [{ kind: 'VOICE', order: 0 }, { kind: 'SCRIPT', order: 1 }] }, 422)
  const step = (await call('POST', '/api/v1/pipeline-steps', { pipelineId: pipeline.id, kind: 'QUALITY_CHECK', order: 2 }, 201)).data
  await call('PATCH', `/api/v1/pipeline-steps/${step.id}`, { instructions: 'Check mock output' })
  await call('PUT', `/api/v1/pipelines/${pipeline.id}/steps/order`, { stepIds: [pipeline.steps[0].id, step.id, pipeline.steps[1].id] })
  await call('DELETE', `/api/v1/pipeline-steps/${step.id}`, undefined, 204)
  await call('PATCH', `/api/v1/pipelines/${pipeline.id}`, { description: 'Configured' })
  const content = (await call('POST', '/api/v1/content', { title: 'Idea', channelId: channel.id, pipelineId: pipeline.id }, 201)).data
  for (const [resource, entity] of [['channels', channel], ['ai-providers', provider], ['pipelines', pipeline], ['content', content], ['pipeline-steps', pipeline.steps[0]]] as const) await otherOwner(resource, entity.id)
  await call('PATCH', `/api/v1/content/${content.id}`, { status: 'READY' }, 409)
  identity = second
  assert.equal((await call('GET', '/api/v1/channels')).pagination.total, 0)
  await call('GET', `/api/v1/content/${content.id}`, undefined, 404)
  await call('PATCH', `/api/v1/channels/${channel.id}`, { name: 'Hijack' }, 404)
  await call('DELETE', `/api/v1/pipelines/${pipeline.id}`, undefined, 404)
  await call('POST', '/api/v1/content', { title: 'Cross owner', channelId: channel.id, pipelineId: pipeline.id }, 404)
  identity = first
  const job = (await call('POST', '/api/v1/jobs', { contentId: content.id }, 201)).data
  await otherOwner('jobs', job.id)
  assert.equal(job.status, 'QUEUED')
  await call('POST', '/api/v1/jobs', { contentId: content.id }, 409)
  await call('PATCH', `/api/v1/pipelines/${pipeline.id}`, { enabled: false }, 409)
  await call('PATCH', `/api/v1/jobs/${job.id}`, { action: 'pause' })
  await call('PATCH', `/api/v1/jobs/${job.id}`, { action: 'pause' }, 409)
  await call('PATCH', `/api/v1/jobs/${job.id}`, { action: 'resume' })
  // Emulate a future worker failure through Prisma, not a public status override.
  await database.job.update({ where: { id: job.id }, data: { status: 'FAILED', completedAt: new Date(), errorMessage: 'Mock failure' } })
  const retried = (await call('PATCH', `/api/v1/jobs/${job.id}`, { action: 'retry' })).data
  assert.equal(retried.attempt, 2)
  await call('PATCH', `/api/v1/jobs/${job.id}`, { action: 'cancel' })
  assert.ok((await call('GET', `/api/v1/jobs/${job.id}/history?limit=2`)).pagination.total >= 4)
  await call('DELETE', `/api/v1/jobs/${job.id}`, undefined, 204)
  for (const status of ['SCRIPT', 'GENERATING', 'EDITING', 'READY']) await call('PATCH', `/api/v1/content/${content.id}`, { status })
  await call('PATCH', '/api/v1/preferences', { timezone: 'Invalid/Zone' }, 422)
  await call('PATCH', '/api/v1/preferences', { workspaceName: 'Workspace', timezone: 'Asia/Kolkata', textProviderId: provider.id, defaultChannelId: channel.id, defaultPipelineId: pipeline.id })
  assert.equal((await call('GET', '/api/v1/preferences')).data.timezone, 'Asia/Kolkata')
  const schedule = (await call('POST', '/api/v1/schedules', { contentId: content.id, scheduledAt: '2099-01-01T10:00:00+05:30' }, 201)).data
  await otherOwner('schedules', schedule.id)
  assert.equal(schedule.scheduledAt, '2099-01-01T04:30:00.000Z')
  assert.equal((await call('GET', `/api/v1/content/${content.id}`)).data.status, 'SCHEDULED')
  const queued = (await call('GET', `/api/v1/jobs?contentId=${content.id}&status=QUEUED`)).data
  assert.equal(queued.length, 1)
  assert.equal((await call('GET', '/api/v1/jobs?type=SCHEDULED_PUBLICATION')).data.length, 1)
  const beforeInvalidSchedule = (await call('GET', '/api/v1/jobs')).pagination.total
  await call('PATCH', `/api/v1/schedules/${schedule.id}`, { scheduledAt: '2000-01-01T00:00:00Z' }, 422)
  assert.equal((await call('GET', '/api/v1/jobs')).pagination.total, beforeInvalidSchedule)
  await call('POST', '/api/v1/schedules', { contentId: content.id, scheduledAt: '2099-01-02T00:00:00Z' }, 409)
  await call('PATCH', `/api/v1/schedules/${schedule.id}`, { scheduledAt: '2099-01-03T00:00:00Z' })
  assert.equal((await call('GET', `/api/v1/jobs?contentId=${content.id}&status=QUEUED`)).data.length, 1)
  await call('DELETE', `/api/v1/schedules/${schedule.id}`, undefined, 204)
  assert.equal((await call('GET', `/api/v1/content/${content.id}`)).data.status, 'READY')
  await call('PATCH', `/api/v1/content/${content.id}`, { status: 'PUBLISHED' })
  await call('PATCH', `/api/v1/content/${content.id}`, { status: 'IDEA' }, 409)
  const analytics = (await call('POST', '/api/v1/analytics', { contentId: content.id, views: '9007199254740993', watchTimeHours: '1.2345', engagementRate: 5 }, 201)).data
  await otherOwner('analytics', analytics.id)
  assert.equal(analytics.views, '9007199254740993')
  await call('PATCH', `/api/v1/analytics/${analytics.id}`, { views: '9007199254740994' })
  await call('DELETE', `/api/v1/analytics/${analytics.id}`, undefined, 204)
  const list = await call('GET', '/api/v1/content?search=idea&limit=1&sort=title&direction=asc')
  assert.equal(list.pagination.total, 1)
  const activities = await call('GET', `/api/v1/activity?contentId=${content.id}`)
  assert.ok(activities.pagination.total > 0)
  await otherOwner('activity', activities.data[0].id, true)
  identity = second
  assert.notEqual((await call('GET', '/api/v1/preferences')).data.workspaceName, 'Workspace')
  await call('PATCH', '/api/v1/preferences', { defaultChannelId: channel.id }, 404)
  identity = first
  await call('POST', '/api/v1/activity', { title: 'Forged' }, 404)
  const linkedBefore = (await call('GET', `/api/v1/activity?channelId=${channel.id}`)).pagination.total
  await call('DELETE', `/api/v1/channels/${channel.id}`, undefined, 409)
  assert.equal((await call('GET', `/api/v1/activity?channelId=${channel.id}`)).pagination.total, linkedBefore, 'Failed deletion must roll back activity unlinking')
  await call('PATCH', '/api/v1/preferences', { defaultChannelId: null, defaultPipelineId: null, textProviderId: null })
  await call('DELETE', `/api/v1/content/${content.id}`, undefined, 204)
  await call('DELETE', `/api/v1/pipelines/${pipeline.id}`, undefined, 204)
  await call('DELETE', `/api/v1/ai-providers/${provider.id}`, undefined, 204)
  await call('DELETE', `/api/v1/channels/${channel.id}`, undefined, 204)
  console.log(`Focused API acceptance passed: ${checks} HTTP assertions using Fastify, Prisma and disposable PostgreSQL SQL.`)
} finally {
  await app.close()
  await closedApp.close()
  await fixture.close()
}
