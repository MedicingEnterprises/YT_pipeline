import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { createApiClient, ApiError } from '../../src/api/client.ts'
import { fetchProviderCatalog, fetchProviderUsage, providerConnection, providerUsageDescription } from '../../src/api/providers.ts'
import { writeBody, emptyWorkspace, fetchWorkspace } from '../../src/api/workspace.ts'
import { validateModelSelection } from '../src/services/providers/catalog.js'
import { buildApp } from '../src/app.js'
import { loadConfig } from '../src/config/env.js'
import { ProviderCredentialService } from '../src/services/providers/credentials.js'
import { providerAdapters } from '../src/services/providers/adapters.js'
import { WorkspaceService } from '../src/services/workspace.service.js'
import { databaseFixture } from './database.fixture.js'

const masterKey = randomBytes(32).toString('base64url')
const vault = new ProviderCredentialService(masterKey)
// Disposable random values, never real provider credentials.
const secret = randomBytes(40).toString('hex')
const encrypted = vault.encrypt('owner', 'provider', secret)
assert.equal(vault.decrypt('owner', 'provider', encrypted), secret)
assert.notEqual(vault.encrypt('owner', 'provider', secret), encrypted)
assert.throws(() => vault.decrypt('other', 'provider', encrypted))
assert.throws(() => vault.decrypt('owner', 'other', encrypted))
assert.throws(() => vault.decrypt('owner', 'provider', encrypted.replace('v1.', 'v2.')))
const parts = encrypted.split('.'); parts[2] = randomBytes(16).toString('base64url')
assert.throws(() => vault.decrypt('owner', 'provider', parts.join('.')))
assert.throws(() => new ProviderCredentialService(randomBytes(32).toString('base64url')).decrypt('owner', 'provider', encrypted))
assert.throws(() => new ProviderCredentialService().encrypt('owner', 'provider', secret))
providerAdapters.get('mock').validateConfiguration(['mock'])
assert.equal(providerAdapters.get('openai').requiresCredential, true)

const fixture = await databaseFixture()
let upstreamStatus = 200
let upstreamCalls = 0
const upstream: typeof fetch = async (url, options) => {
  if (String(url) === 'https://api.openai.com/v1/responses') return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Disposable generated text' }] }], usage: { input_tokens: 12, output_tokens: 7 } })
  upstreamCalls++; assert.equal(String(url), 'https://api.openai.com/v1/models'); assert.equal(new Headers(options?.headers).get('Authorization'), 'Bearer ' + secret)
  return new Response(JSON.stringify(upstreamStatus === 200 ? { data: [] } : { error: { message: secret } }), { status: upstreamStatus })
}
const app = buildApp(loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://localhost/unused', SESSION_SECRET: randomBytes(32).toString('base64url'), PROVIDER_ENCRYPTION_KEY: masterKey, LOG_LEVEL: 'silent' }), { database: fixture.database, providerProbe: { fetch: upstream } })
const cookies = new Map<string, string>()
let csrf = ''
async function request(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) {
  const reply = await app.inject({ method, url, headers: { cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '), 'x-csrf-token': csrf }, ...(payload ? { payload } : {}) })
  for (const cookie of reply.cookies) cookies.set(cookie.name, cookie.value)
  assert.ok(!reply.body.includes(secret), 'Responses must not contain credentials')
  assert.ok(!reply.body.includes('envelope'), 'Responses must not contain ciphertext')
  return reply
}
try {
  assert.equal((await request('GET', '/api/v1/ai-provider-catalog')).statusCode, 401)
  csrf = (await request('GET', '/api/v1/auth/csrf')).json().data.csrfToken
  // Auth endpoint uses a top-level csrfToken (accept either existing envelope shape).
  if (!csrf) throw new Error('CSRF response shape changed')
  const registration = await request('POST', '/api/v1/auth/register', { displayName: 'Provider test', email: 'provider-test@example.invalid', password: 'Disposable provider test password!' })
  assert.equal(registration.statusCode, 201)
  csrf = (await request('GET', '/api/v1/auth/csrf')).json().data.csrfToken
  const created = await request('POST', '/api/v1/ai-providers', { name: 'Secure provider', category: 'TEXT_GENERATION', models: ['mock'], apiKey: secret })
  assert.equal(created.statusCode, 201, created.body)
  const id = created.json().data.id
  const stored = await fixture.database.providerCredential.findUniqueOrThrow({ where: { providerId: id } })
  assert.ok(!stored.envelope.includes(secret))
  assert.equal(vault.decrypt(stored.userId, id, stored.envelope), secret)
  for (const path of ['/api/v1/ai-providers', `/api/v1/ai-providers/${id}`, '/api/v1/workspace']) assert.equal((await request('GET', path)).statusCode, 200)
  assert.equal((await request('PATCH', `/api/v1/ai-providers/${id}`, { name: 'Renamed' })).statusCode, 200)
  assert.equal((await fixture.database.providerCredential.findUniqueOrThrow({ where: { providerId: id } })).envelope, stored.envelope)
  assert.equal((await request('PATCH', `/api/v1/ai-providers/${id}`, { apiKey: secret })).statusCode, 200)
  assert.notEqual((await fixture.database.providerCredential.findUniqueOrThrow({ where: { providerId: id } })).envelope, stored.envelope)
  const other = await fixture.database.user.create({ data: { email: 'other-provider@example.invalid', displayName: 'Other' } })
  await assert.rejects(new WorkspaceService(fixture.database, masterKey).save('ai-providers', other.id, { apiKey: secret }, id), { statusCode: 404 })
  await assert.rejects(new WorkspaceService(fixture.database).save('ai-providers', stored.userId, { name: 'Must roll back', category: 'TEXT_GENERATION', models: ['mock'], apiKey: secret }), { statusCode: 503 })
  assert.equal(await fixture.database.aIProvider.count({ where: { name: 'Must roll back' } }), 0)
  const api = createApiClient({ fetch: async (url, options = {}) => {
    assert.equal(options.credentials, 'include')
    const reply = await request((options.method ?? 'GET') as 'GET' | 'POST' | 'PATCH' | 'DELETE', String(url), options.body ? JSON.parse(String(options.body)) : undefined)
    return new Response(reply.statusCode === 204 ? null : reply.body, { status: reply.statusCode, headers: { 'Content-Type': 'application/json' } })
  } })
  const initialUsage = await fetchProviderUsage(api)
  assert.match(providerUsageDescription(initialUsage), /No requests recorded/)
  const catalog = await fetchProviderCatalog(api)
  assert.equal(catalog.length, 5)
  assert.equal(catalog.find(item => item.id === 'openai')?.models[0]?.category, 'Text generation')
  for (const provider of catalog) for (const model of provider.models) assert.ok(model.id)
  assert.throws(() => validateModelSelection('openai', 'TEXT_GENERATION', ['invented-model']), { code: 'MODEL_UNAVAILABLE' })
  assert.throws(() => validateModelSelection('elevenlabs', 'TEXT_GENERATION', ['eleven_multilingual_v2']), { code: 'MODEL_UNAVAILABLE' })
  const body = writeBody('provider', { name: 'Selected provider', adapterId: 'openai', category: 'Text generation', models: ['gpt-4.1-mini'], enabled: true }, emptyWorkspace())
  await api.request(`/api/v1/ai-providers/${id}`, 'PATCH', body)
  await assert.rejects(api.request(`/api/v1/ai-providers/${id}`, 'PATCH', { models: ['eleven_multilingual_v2'] }), (error: unknown) => error instanceof ApiError && error.code === 'MODEL_UNAVAILABLE')
  await assert.rejects(api.request(`/api/v1/ai-providers/${id}`, 'PATCH', { category: 'TEXT_TO_SPEECH' }), (error: unknown) => error instanceof ApiError && error.code === 'MODEL_UNAVAILABLE')
  await assert.rejects(api.request('/api/v1/preferences', 'PATCH', { textProviderId: id }), (error: unknown) => error instanceof ApiError && error.status === 422)
  assert.equal((await fixture.database.aIProvider.findUniqueOrThrow({ where: { id } })).models[0], 'gpt-4.1-mini')
  const verified = await request('POST', `/api/v1/ai-providers/${id}/test-connection`)
  assert.equal(verified.statusCode, 200, verified.body)
  const successfulAt = (await fixture.database.aIProvider.findUniqueOrThrow({ where: { id } })).lastConnectedAt
  assert.ok(successfulAt)
  await api.request('/api/v1/preferences', 'PATCH', { textProviderId: id })
  const restored = await fetchWorkspace(api)
  assert.equal(restored.preferences?.textProviderId, id)
  assert.equal(restored.providers.get(id)?.models[0], 'gpt-4.1-mini')
  assert.equal(restored.providers.get(id)?.adapterId, 'openai')
  assert.equal(providerConnection(restored.providers.get(id)!).label, 'Connected')
  assert.equal(providerConnection({ adapterId: 'mock', connected: true, lastConnectedAt: null }).verified, false)
  assert.equal(providerConnection({ adapterId: 'openai', connected: true, lastConnectedAt: null }).label, 'Not verified')
  await api.request('/api/v1/ai/text', 'POST', { requestId: randomUUID(), prompt: 'Disposable safe prompt', maxOutputTokens: 128 })
  const usage = await fetchProviderUsage(api)
  assert.equal(usage.pagination.total, 1); assert.equal(usage.data[0]?.model, 'gpt-4.1-mini')
  assert.equal(usage.data[0]?.providerId, id); assert.equal(usage.data[0]?.status, 'SUCCEEDED')
  assert.equal(usage.data[0]?.inputTokens, 12); assert.equal(usage.data[0]?.outputTokens, 7)
  assert.match(providerUsageDescription(usage), /1 succeeded/)
  assert.ok(providerUsageDescription(usage).includes('12 input / 7 output'))
  assert.match(providerUsageDescription(usage), /Cost unknown/)
  assert.ok(!JSON.stringify(usage).includes('Disposable generated text'))
  assert.ok(!JSON.stringify(usage).includes('Disposable safe prompt'))
  assert.notEqual((await fetchWorkspace(api)).providers.get(id)?.lastUsed, 'Never')
  const anonymous = await app.inject({ method: 'GET', url: '/api/v1/ai/usage' }); assert.equal(anonymous.statusCode, 401)
  const isolatedCookies = new Map<string, string>()
  const isolated = createApiClient({ fetch: async (url, options = {}) => {
    assert.equal(options.credentials, 'include')
    const headers = Object.fromEntries(new Headers(options.headers).entries())
    headers.cookie = [...isolatedCookies].map(([k,v]) => k + '=' + v).join('; ')
    const reply = await app.inject({ method: (options.method ?? 'GET') as 'GET' | 'POST' | 'PATCH' | 'DELETE', url: String(url), headers, remoteAddress: '192.0.2.75', ...(options.body ? { payload: String(options.body) } : {}) })
    for (const cookie of reply.cookies) isolatedCookies.set(cookie.name, cookie.value)
    assert.ok(!reply.body.includes(secret))
    return new Response(reply.statusCode === 204 ? null : reply.body, { status: reply.statusCode, headers: { 'Content-Type': 'application/json' } })
  } })
  await isolated.request('/api/v1/auth/register', 'POST', { email: 'isolated-ui@example.invalid', displayName: 'Other UI user', password: 'Disposable UI isolation password!' })
  isolated.invalidateCsrf() // Registration rotates the protection proof, as AuthProvider does.
  assert.equal((await fetchProviderUsage(isolated)).pagination.total, 0)
  assert.equal((await fetchWorkspace(isolated)).providers.size, 0)
  await assert.rejects(isolated.request(`/api/v1/ai-providers/${id}`, 'PATCH', { name: 'Other user edit' }), (error: unknown) => error instanceof ApiError && error.status === 404)
  await assert.rejects(isolated.request(`/api/v1/ai-providers/${id}`, 'DELETE'), (error: unknown) => error instanceof ApiError && error.status === 404)
  await assert.rejects(isolated.request(`/api/v1/ai-providers/${id}/test-connection`, 'POST'), (error: unknown) => error instanceof ApiError && error.status === 404)
  await assert.rejects(new WorkspaceService(fixture.database).preferences(other.id, { textProviderId: id }), { statusCode: 404 })
  assert.equal((await fixture.database.aIProvider.findUniqueOrThrow({ where: { id } })).connected, true)
  assert.equal((await request('PATCH', `/api/v1/ai-providers/${id}`, { connected: true })).statusCode, 422)
  upstreamStatus = 401
  const failed = await request('POST', `/api/v1/ai-providers/${id}/test-connection`)
  assert.equal(failed.statusCode, 422); assert.equal(failed.json().error.code, 'PROVIDER_INVALID_KEY')
  assert.equal((await fixture.database.aIProvider.findUniqueOrThrow({ where: { id } })).connected, false)
  assert.equal(providerConnection((await fetchWorkspace(api)).providers.get(id)!).label, 'Not connected')
  assert.equal((await fixture.database.aIProvider.findUniqueOrThrow({ where: { id } })).lastConnectedAt?.toISOString(), successfulAt?.toISOString())
  assert.equal((await request('PATCH', `/api/v1/ai-providers/${id}`, { apiKey: secret })).statusCode, 200)
  assert.equal((await fixture.database.aIProvider.findUniqueOrThrow({ where: { id } })).lastConnectedAt, null)
  assert.equal(upstreamCalls, 2)
  assert.equal((await request('PATCH', `/api/v1/ai-providers/${id}`, { apiKey: null })).statusCode, 200)
  assert.equal((await request('POST', `/api/v1/ai-providers/${id}/test-connection`)).statusCode, 422)
  assert.equal(upstreamCalls, 2)
  assert.equal(await fixture.database.providerCredential.count(), 0)
  assert.equal((await request('PATCH', `/api/v1/ai-providers/${id}`, { apiKey: secret })).statusCode, 200)
  await api.request('/api/v1/preferences', 'PATCH', { textProviderId: null })
  assert.equal((await request('DELETE', `/api/v1/ai-providers/${id}`)).statusCode, 204)
  assert.equal(await fixture.database.providerCredential.count(), 0)
  console.log('Provider/model selection acceptance passed: catalog, client DTOs, incompatible IDs, defaults, restoration, ownership;  encryption, tamper/owner binding, CRUD, response secrecy, ownership, rollback and cascade deletion.')
} finally {
  await app.close(); await fixture.close()
}
