import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { providerAdapters } from '../src/services/providers/adapters.js'

const key = randomBytes(32).toString('hex')
const bodies = { openai: { data: [] }, anthropic: { data: [] }, elevenlabs: { user_id: 'disposable' }, stability: { id: 'disposable' }, runway: { creditBalance: 0 } }
for (const id of Object.keys(bodies) as (keyof typeof bodies)[]) {
  let calls = 0
  await providerAdapters.get(id).testConnection(key, { fetch: async (url, options) => {
    calls++
    assert.ok(String(url).startsWith('https://'))
    assert.equal(options?.method, 'GET'); assert.equal(options?.redirect, 'error')
    const headers = new Headers(options?.headers)
    assert.equal(headers.get(id === 'anthropic' ? 'x-api-key' : id === 'elevenlabs' ? 'xi-api-key' : 'Authorization'), ['anthropic', 'elevenlabs'].includes(id) ? key : `Bearer ${key}`)
    if (id === 'anthropic') assert.equal(headers.get('anthropic-version'), '2023-06-01')
    if (id === 'runway') assert.equal(headers.get('X-Runway-Version'), '2024-11-06')
    return Response.json(bodies[id])
  } })
  assert.equal(calls, 1)
}
for (const [status, code] of [[401, 'PROVIDER_INVALID_KEY'], [403, 'PROVIDER_ACCESS_DENIED'], [429, 'PROVIDER_RATE_LIMITED'], [503, 'PROVIDER_UNAVAILABLE'], [400, 'PROVIDER_REJECTED'], [302, 'PROVIDER_REJECTED']] as const) {
  await assert.rejects(providerAdapters.get('openai').testConnection(key, { fetch: async () => new Response(key, { status }) }), (error: any) => error.code === code && !error.message.includes(key))
}
for (const body of ['not json', '{}', 'null', '[]', JSON.stringify({ data: key }), ' '.repeat(1024 * 1024 + 1)]) {
  await assert.rejects(providerAdapters.get('openai').testConnection(key, { fetch: async () => new Response(body) }), (error: any) => !error.message.includes(key))
}
await assert.rejects(providerAdapters.get('openai').testConnection(key, { fetch: async () => { throw new Error(key) } }), (error: any) => error.code === 'PROVIDER_CONNECTION_FAILED' && !error.message.includes(key))
await assert.rejects(providerAdapters.get('openai').testConnection(key, { timeoutMs: 5, fetch: async (_url, options) => new Promise((_resolve, reject) => {
  options?.signal?.addEventListener('abort', () => reject(new Error(key)), { once: true })
}) }), { code: 'PROVIDER_TIMEOUT' })
await assert.rejects(providerAdapters.get('mock').testConnection(''), { code: 'MOCK_PROVIDER' })
console.log('Connection adapter tests passed: five providers, headers, error mapping, response limits, timeout, redirects and secret suppression.')
