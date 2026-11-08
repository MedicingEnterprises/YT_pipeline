import { HttpError } from '../../middleware/errors.js'

export interface ProbeOptions { fetch?: typeof fetch; timeoutMs?: number }
/** Internal bounded transport. Callers project allowed fields; never expose raw payloads. No retries. */
export async function providerJson(url: string, headers: Record<string, string>, valid: (body: Record<string, unknown>) => boolean, options: ProbeOptions = {}, bodyInput?: object): Promise<Record<string, unknown>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10000)
  let response: Response | undefined
  try {
    response = await (options.fetch ?? fetch)(url, { method: bodyInput ? 'POST' : 'GET', ...(bodyInput ? { body: JSON.stringify(bodyInput) } : {}), headers, signal: controller.signal, redirect: 'error', cache: 'no-store' })
    if (response.status === 401) throw new HttpError(422, 'PROVIDER_INVALID_KEY', 'The provider rejected this API key')
    if (response.status === 403) throw new HttpError(422, 'PROVIDER_ACCESS_DENIED', 'The key lacks permission for this provider request')
    if (response.status === 429) throw new HttpError(503, 'PROVIDER_RATE_LIMITED', 'The provider rate limit was reached. Try again later')
    if (response.status >= 500) throw new HttpError(503, 'PROVIDER_UNAVAILABLE', 'The provider is temporarily unavailable')
    if (!response.ok) throw new HttpError(502, 'PROVIDER_REJECTED', 'The provider rejected this request')
    // Bound both body size and read time, including a slow response after headers.
    const reader = response.body?.getReader()
    if (!reader) throw new HttpError(502, 'PROVIDER_INVALID_RESPONSE', 'The provider returned an unexpected response')
    let size = 0
    const chunks: Uint8Array[] = []
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 1024 * 1024) throw new HttpError(502, 'PROVIDER_INVALID_RESPONSE', 'The provider returned an unexpected response')
        chunks.push(value)
      }
    } finally { await reader.cancel().catch(() => {}) }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!body || typeof body !== 'object' || Array.isArray(body) || !valid(body as Record<string, unknown>)) throw new Error()
    return body as Record<string, unknown>
  } catch (error) {
    if (controller.signal.aborted) throw new HttpError(504, 'PROVIDER_TIMEOUT', 'The provider request timed out')
    if (error instanceof HttpError) throw error
    // Never propagate provider messages or fetch exceptions containing headers/keys.
    throw new HttpError(502, 'PROVIDER_CONNECTION_FAILED', 'Could not verify the provider connection. Check service availability and try again')
  } finally {
    clearTimeout(timer)
    if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {})
  }
}

export async function probe(url: string, headers: Record<string, string>, valid: (body: Record<string, unknown>) => boolean, options: ProbeOptions = {}): Promise<void> {
  await providerJson(url, headers, valid, options)
}
