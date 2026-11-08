import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { buildApp } from '../src/app.js'
import { loadConfig } from '../src/config/env.js'
import { WorkspaceService } from '../src/services/workspace.service.js'
import { ProviderCredentialService } from '../src/services/providers/credentials.js'
import { databaseFixture } from './database.fixture.js'

const fixture = await databaseFixture(), db = fixture.database
const secret = randomBytes(32).toString('hex'), master = randomBytes(32).toString('base64url'), sessionSecret = randomBytes(32).toString('base64url')
let now = new Date('2026-11-08T12:00:00Z'), mode = 'success', calls = 0, requestNumber = 0
let release: (() => void) | undefined, started: (() => void) | undefined
const transport: typeof fetch = async (url, options) => {
  calls++
  assert.equal(options?.method, 'POST'); assert.equal(options?.redirect, 'error')
  const anthropic = String(url) === 'https://api.anthropic.com/v1/messages'
  assert.ok(anthropic || String(url) === 'https://api.openai.com/v1/responses')
  const headers = new Headers(options?.headers), body = JSON.parse(String(options?.body))
  assert.equal(headers.get(anthropic ? 'x-api-key' : 'Authorization'), anthropic ? secret : `Bearer ${secret}`)
  assert.equal(body.stream, false)
  if (!anthropic) { assert.equal(body.store, false); assert.equal(body.max_output_tokens, 128); assert.equal(body.instructions, 'Be concise') }
  else assert.equal(body.max_tokens, 128)
  if (mode === 'hold') { started?.(); await new Promise<void>(resolve => { release = resolve }) }
  if (mode === 'timeout') return new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new Error(secret)), { once: true }))
  if (mode === 'network') throw new Error(secret)
  if (mode === 'bad') return Response.json({ sensitive: secret })
  if (['401', '429', '503'].includes(mode)) return Response.json({ error: { message: secret, headers: { Authorization: secret } } }, { status: Number(mode) })
  const text = mode === 'echo' ? secret : 'Generated text'
  return Response.json(anthropic
    ? { content: [{ type: 'thinking', thinking: 'private reasoning' }, { type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 9, output_tokens: 4, cache_read_input_tokens: 2, cache_creation_input_tokens: 1 }, private: secret }
    : { status: 'completed', output: [{ type: 'reasoning', summary: 'private reasoning' }, { type: 'message', content: [{ type: 'output_text', text }] }], usage: { input_tokens: 12, output_tokens: 7, input_tokens_details: { cached_tokens: 3 } }, private: secret })
}
const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://localhost/unused', SESSION_SECRET: sessionSecret, PROVIDER_ENCRYPTION_KEY: master, LOG_LEVEL: 'silent' })
const app = buildApp(config, { database: db, now: () => now, providerProbe: { fetch: transport, timeoutMs: 20 } })
const client = () => ({ cookies: new Map<string, string>(), csrf: '' })
const alice = client(), bob = client()
async function call(who: ReturnType<typeof client>, method: 'GET' | 'POST', path: string, payload?: object, expected = 200, proof = true) {
  // Vary IP to prove database limits apply per account, independent of IP.
  const reply = await app.inject({ method, url: path, remoteAddress: `192.0.2.${++requestNumber % 200 + 1}`, headers: { cookie: [...who.cookies].map(([k, v]) => `${k}=${v}`).join('; '), ...(proof ? { 'x-csrf-token': who.csrf } : {}) }, ...(payload ? { payload } : {}) })
  assert.equal(reply.statusCode, expected, `${path}: ${reply.body}`)
  for (const cookie of reply.cookies) who.cookies.set(cookie.name, cookie.value)
  for (const value of [secret, master, sessionSecret, 'private reasoning']) assert.ok(!reply.body.includes(value))
  return reply
}
async function register(who: ReturnType<typeof client>, email: string) {
  who.csrf = (await call(who, 'GET', '/api/v1/auth/csrf')).json().data.csrfToken
  const user = (await call(who, 'POST', '/api/v1/auth/register', { email, displayName: 'AI test', password: 'Disposable AI testing password 1!' }, 201)).json().data.user
  who.csrf = (await call(who, 'GET', '/api/v1/auth/csrf')).json().data.csrfToken
  return user.id as string
}
let providerId = ''
const input = (extra = {}) => ({ requestId: randomUUID(), providerId, prompt: 'A safe test prompt', systemPrompt: 'Be concise', maxOutputTokens: 128, ...extra })
try {
  await call(alice, 'POST', '/api/v1/ai/text', input({ providerId: undefined }), 401)
  await call(alice, 'GET', '/api/v1/ai/usage', undefined, 401)
  const aliceId = await register(alice, 'ai-alice@example.invalid'), bobId = await register(bob, 'ai-bob@example.invalid')
  const provider = await db.aIProvider.create({ data: { userId: aliceId, name: 'Text provider', adapterId: 'openai', category: 'TEXT_GENERATION', models: ['gpt-4.1-mini'], connected: true } })
  providerId = provider.id
  await new ProviderCredentialService(master).save(db, aliceId, providerId, secret)
  await db.userPreferences.update({ where: { userId: aliceId }, data: { textProviderId: providerId } })
  await call(alice, 'POST', '/api/v1/ai/text', input(), 403, false)
  await call(bob, 'POST', '/api/v1/ai/text', input(), 404)
  await call(alice, 'POST', '/api/v1/ai/text', input({ maxOutputTokens: 999999 }), 400)
  await call(alice, 'POST', '/api/v1/ai/text', input({ model: 'invented-model' }), 422)
  assert.equal(calls, 0)
  const first = input({ temperature: 0.5, providerId: undefined }) // Saved default provider/model.
  const generated = (await call(alice, 'POST', '/api/v1/ai/text', first)).json().data
  assert.equal(generated.text, 'Generated text'); assert.equal(generated.model, 'gpt-4.1-mini')
  assert.equal(generated.usage.inputTokens, 12); assert.equal(generated.usage.cacheReadTokens, 3); assert.equal(generated.usage.estimatedCostUsd, null)
  await call(alice, 'POST', '/api/v1/ai/text', first, 409); assert.equal(calls, 1)
  const saved = await db.aIUsage.findUniqueOrThrow({ where: { id: generated.usageId } })
  assert.equal(saved.status, 'SUCCEEDED'); assert.equal(saved.inputTokens, 12); assert.equal(saved.userId, aliceId)
  assert.ok(!JSON.stringify(saved).includes(first.prompt)); assert.ok(!JSON.stringify(saved).includes('Generated text'))
  assert.equal((await call(bob, 'GET', '/api/v1/ai/usage')).json().pagination.total, 0)
  assert.equal((await call(bob, 'GET', `/api/v1/ai/usage?requestId=${first.requestId}`)).json().pagination.total, 0)
  for (const [next, status, code] of [['401', 422, 'PROVIDER_INVALID_KEY'], ['429', 503, 'PROVIDER_RATE_LIMITED'], ['503', 503, 'PROVIDER_UNAVAILABLE'], ['bad', 502, 'PROVIDER_INVALID_RESPONSE'], ['timeout', 504, 'PROVIDER_TIMEOUT'], ['network', 502, 'PROVIDER_CONNECTION_FAILED'], ['echo', 502, 'PROVIDER_UNSAFE_RESPONSE']] as const) {
    now = new Date(now.getTime() + 61000); mode = next
    const body = input(), reply = await call(alice, 'POST', '/api/v1/ai/text', body, status)
    assert.equal(reply.json().error.code, code)
    const row = await db.aIUsage.findUniqueOrThrow({ where: { userId_requestId: { userId: aliceId, requestId: body.requestId } } })
    assert.equal(row.status, 'FAILED'); assert.equal(row.errorCode, code)
  }
  now = new Date(now.getTime() + 61000); mode = 'success'
  const anthropic = await db.aIProvider.create({ data: { userId: aliceId, name: 'Claude', adapterId: 'anthropic', category: 'TEXT_GENERATION', models: ['claude-sonnet-5-5'], connected: true } })
  await new ProviderCredentialService(master).save(db, aliceId, anthropic.id, secret)
  const claude = (await call(alice, 'POST', '/api/v1/ai/text', input({ providerId: anthropic.id }))).json().data
  assert.equal(claude.usage.outputTokens, 4); assert.equal(claude.usage.cacheWriteTokens, 1)
  await call(alice, 'POST', '/api/v1/ai/text', input({ providerId: anthropic.id, temperature: 0.5 }), 422)
  mode = 'hold'
  const barrier = new Promise<void>(resolve => { started = resolve })
  const held = call(alice, 'POST', '/api/v1/ai/text', input())
  await barrier
  const beforeConcurrent = calls
  await call(alice, 'POST', '/api/v1/ai/text', input(), 409)
  assert.equal(calls, beforeConcurrent); release!(); await held
  now = new Date(now.getTime() + 61000); mode = 'success'
  for (let i = 0; i < 5; i++) await call(alice, 'POST', '/api/v1/ai/text', input())
  const beforeLimit = calls
  await call(alice, 'POST', '/api/v1/ai/text', input(), 429); assert.equal(calls, beforeLimit)
  now = new Date(now.getTime() + 61000)
  const total = await db.aIUsage.count({ where: { userId: aliceId } })
  await db.aIUsage.createMany({ data: Array.from({ length: 50 - total }, () => ({ id: randomUUID(), userId: aliceId, providerId, adapterId: 'openai', model: 'gpt-4.1-mini', requestId: randomUUID(), status: 'FAILED' as const, requestedAt: new Date('2026-11-08T00:01:00Z'), completedAt: new Date('2026-11-08T00:02:00Z'), errorCode: 'AI_REQUEST_FAILED' })) })
  await call(alice, 'POST', '/api/v1/ai/text', input(), 429); assert.equal(calls, beforeLimit)
  const history = (await call(alice, 'GET', '/api/v1/ai/usage?limit=5')).json()
  assert.equal(history.data.length, 5); assert.equal(history.pagination.total, 50)
  // Restart-independent history and bounds come from PostgreSQL, not a JS counter.
  const { AIRequestService } = await import('../src/services/ai-request.service.js')
  const restarted = new AIRequestService(db, master, { fetch: transport }, [], () => now)
  await assert.rejects(restarted.generate(aliceId, input()), { statusCode: 429 })
  assert.equal((await restarted.usage(bobId, { page: 1, limit: 5 })).pagination.total, 0)
  // Provider removal retains historical usage snapshots.
  await db.userPreferences.update({ where: { userId: aliceId }, data: { textProviderId: null } })
  await new WorkspaceService(db).remove('ai-providers', aliceId, providerId)
  assert.equal(await db.aIUsage.count({ where: { userId: aliceId } }), 50)
  console.log('AI request acceptance passed: both providers, defaults, token persistence, ownership/CSRF, safe errors, timeout, duplicate/concurrency/minute/day/restart limits and retained history. No live AI calls.')
} finally { await app.close(); await fixture.close() }
