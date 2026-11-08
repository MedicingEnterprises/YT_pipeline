import { HttpError } from '../../middleware/errors.js'
import { providerJson, type ProbeOptions } from './http.js'

export interface TextGenerationInput { model: string; prompt: string; systemPrompt?: string; maxOutputTokens: number; temperature?: number }
export interface TokenUsage { inputTokens: number | null; outputTokens: number | null; cacheReadTokens: number | null; cacheWriteTokens: number | null }
export interface TextGenerationResult { text: string; finishReason: 'stop' | 'length'; usage: TokenUsage }
const invalid = () => new HttpError(502, 'PROVIDER_INVALID_RESPONSE', 'The provider returned an invalid text response')
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid()
  return value as Record<string, unknown>
}
function tokens(value: unknown): number | null {
  if (value === undefined || value === null) return null
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 2147483647) throw invalid()
  return Number(value)
}
export async function generateProviderText(id: 'openai' | 'anthropic', apiKey: string, input: TextGenerationInput, options: ProbeOptions = {}): Promise<TextGenerationResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' }
  let payload: object
  if (id === 'openai') {
    headers.Authorization = `Bearer ${apiKey}`
    payload = { model: input.model, input: input.prompt, ...(input.systemPrompt ? { instructions: input.systemPrompt } : {}), max_output_tokens: input.maxOutputTokens, ...(input.temperature !== undefined ? { temperature: input.temperature } : {}), store: false, stream: false }
  } else {
    if (input.temperature !== undefined) throw new HttpError(422, 'UNSUPPORTED_PARAMETER', 'Temperature is not supported for the configured Anthropic model')
    headers['x-api-key'] = apiKey; headers['anthropic-version'] = '2023-06-01'
    payload = { model: input.model, messages: [{ role: 'user', content: input.prompt }], ...(input.systemPrompt ? { system: input.systemPrompt } : {}), max_tokens: input.maxOutputTokens, stream: false }
  }
  const body = await providerJson(id === 'openai' ? 'https://api.openai.com/v1/responses' : 'https://api.anthropic.com/v1/messages', headers, () => true, { ...options, timeoutMs: options.timeoutMs ?? 30000 }, payload)
  const usage = body.usage === undefined ? {} : record(body.usage)
  let text = '', finishReason: 'stop' | 'length' = 'stop'
  if (id === 'openai') {
    if (!['completed', 'incomplete'].includes(String(body.status)) || !Array.isArray(body.output)) throw invalid()
    if (body.status === 'incomplete') {
      if (record(body.incomplete_details).reason !== 'max_output_tokens') throw invalid()
      finishReason = 'length'
    }
    for (const item of body.output) {
      const message = record(item)
      if (message.type !== 'message') continue // Never expose reasoning or tool payloads.
      if (!Array.isArray(message.content)) throw invalid()
      for (const content of message.content) {
        const part = record(content)
        if (part.type === 'output_text' && typeof part.text === 'string') text += part.text
      }
    }
  } else {
    if (!Array.isArray(body.content) || !['end_turn', 'max_tokens', 'stop_sequence'].includes(String(body.stop_reason))) throw invalid()
    finishReason = body.stop_reason === 'max_tokens' ? 'length' : 'stop'
    for (const value of body.content) { const part = record(value); if (part.type === 'text' && typeof part.text === 'string') text += part.text }
  }
  if (!text.trim() || text.length > 65536) throw invalid()
  return { text, finishReason, usage: { inputTokens: tokens(usage.input_tokens), outputTokens: tokens(usage.output_tokens), cacheReadTokens: tokens(id === 'openai' ? usage.input_tokens_details === undefined ? undefined : record(usage.input_tokens_details).cached_tokens : usage.cache_read_input_tokens), cacheWriteTokens: tokens(id === 'anthropic' ? usage.cache_creation_input_tokens : undefined) } }
}
