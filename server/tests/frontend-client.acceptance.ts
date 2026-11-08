import assert from 'node:assert/strict'
import { createApiClient, ApiError } from '../../src/api/client.ts'

let proofs = 0, mutations = 0, unauthorized = 0, failCsrf = false
const transport: typeof fetch = async (url, options = {}) => {
  assert.equal(options.credentials, 'include')
  if (String(url).endsWith('/auth/csrf')) { proofs++; await Promise.resolve(); return Response.json({ data: { csrfToken: `proof-${proofs}` } }) }
  if (String(url).endsWith('/expired') || String(url).endsWith('/auth/login')) return Response.json({ error: { code: 'UNAUTHORIZED', message: 'Sign in' } }, { status: 401 })
  mutations++
  assert.equal(new Headers(options.headers).get('x-csrf-token'), `proof-${proofs}`)
  if (failCsrf) return Response.json({ error: { code: 'CSRF_INVALID', message: 'Refresh CSRF' } }, { status: 403 })
  return Response.json({ data: { id: 'record' } })
}
const api = createApiClient({ baseUrl: 'https://api.example.invalid/', fetch: transport, unauthorized: () => unauthorized++ })
await Promise.all([api.request('/one', 'POST', {}), api.request('/two', 'POST', {})])
assert.equal(proofs, 1, 'Concurrent requests share only the proof fetch, not mutation responses')
assert.equal(mutations, 2)
failCsrf = true
await assert.rejects(api.request('/three', 'POST', {}), error => error instanceof ApiError && error.status === 403)
assert.equal(mutations, 3, 'A failed write is never automatically replayed')
failCsrf = false
await api.request('/four', 'POST', {})
assert.equal(proofs, 2)
await assert.rejects(api.request('/api/v1/auth/login', 'POST', {}))
assert.equal(unauthorized, 0, 'Incorrect sign-in does not clear a different authenticated account')
await assert.rejects(api.request('/expired'))
assert.equal(unauthorized, 1)
const controller = new AbortController()
const stale = createApiClient({ fetch: async () => { controller.abort(); return Response.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 }) }, unauthorized: () => unauthorized++ })
await assert.rejects(stale.request('/expired', 'GET', undefined, controller.signal), error => error instanceof ApiError && error.code === 'ABORTED')
assert.equal(unauthorized, 1, 'An aborted stale request cannot clear a newer session')
const offline = createApiClient({ fetch: async () => { throw Error('offline') } })
await assert.rejects(offline.request('/data'), error => error instanceof ApiError && error.status === 0)
console.log('Frontend API client checks passed: credentials, CSRF coalescing/invalidation, no write replay, unauthorized handling, aborted stale requests and offline errors.')
