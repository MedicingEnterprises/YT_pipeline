export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly fields: Record<string, string>
  constructor(status: number, code: string, message: string, fields: Record<string, string> = {}) { super(message); this.status = status; this.code = code; this.fields = fields }
}
export interface TransportOptions { baseUrl?: string; fetch?: typeof fetch; unauthorized?: () => void }
export function createApiClient(options: TransportOptions = {}) {
  const base = (options.baseUrl ?? '').replace(/\/$/, '')
  const transport = options.fetch ?? globalThis.fetch.bind(globalThis)
  let proof: string | null = null
  let pendingProof: Promise<string> | null = null
  let generation = 0
  const invalidateCsrf = () => { generation++; proof = null; pendingProof = null }
  async function request<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 30000)
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) controller.abort()
    try {
      const csrf = !['GET', 'HEAD'].includes(method) ? await csrfToken() : undefined
      const response = await transport(`${base}${path}`, { method, credentials: 'include', cache: 'no-store', signal: controller.signal, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(csrf ? { 'X-CSRF-Token': csrf } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
      const data = response.status === 204 ? undefined : await response.json().catch(() => undefined)
      if (controller.signal.aborted) throw new ApiError(0, 'ABORTED', 'The request was interrupted. Refresh to check server state before retrying.')
      if (!response.ok) {
        if (response.status === 401 && !['/api/v1/auth/login', '/api/v1/auth/register'].includes(path)) { invalidateCsrf(); options.unauthorized?.() }
        if (response.status === 403) invalidateCsrf()
        throw new ApiError(response.status, data?.error?.code ?? 'REQUEST_FAILED', data?.error?.message ?? `Request failed (${response.status})`, data?.error?.fields)
      }
      if (response.status !== 204 && data === undefined) throw new ApiError(502, 'INVALID_RESPONSE', 'The backend returned an invalid response.')
      return data as T
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(0, controller.signal.aborted ? 'ABORTED' : 'NETWORK_ERROR', controller.signal.aborted ? 'The request was interrupted. Refresh to check server state before retrying.' : 'Could not reach the backend. Check your connection and retry.')
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
  }
  async function csrfToken(): Promise<string> {
    if (proof) return proof
    if (pendingProof) return pendingProof
    const epoch = generation
    const pending = request<{ data: { csrfToken: string } }>('/api/v1/auth/csrf').then(result => {
      if (epoch !== generation) throw new ApiError(0, 'SESSION_CHANGED', 'The session changed. Please retry.')
      proof = result.data.csrfToken; return proof
    }).finally(() => { if (pendingProof === pending) pendingProof = null })
    pendingProof = pending
    return pending
  }
  return { request, invalidateCsrf }
}
export type ApiClient = ReturnType<typeof createApiClient>
