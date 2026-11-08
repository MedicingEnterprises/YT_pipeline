import { generateProviderText, type TextGenerationInput, type TextGenerationResult } from './text.js'
import { probe, type ProbeOptions } from './http.js'
import { HttpError } from '../../middleware/errors.js'

export const adapterIds = ['mock', 'openai', 'anthropic', 'elevenlabs', 'stability', 'runway'] as const
export type AdapterId = typeof adapterIds[number]
export interface ProviderAdapter {
  readonly id: AdapterId
  readonly requiresCredential: boolean
  testConnection(apiKey: string, options?: ProbeOptions): Promise<void>
  generateText?(apiKey: string, input: TextGenerationInput, options?: ProbeOptions): Promise<TextGenerationResult>
  validateConfiguration(models: readonly string[]): void
}
export class ProviderAdapterRegistry {
  private readonly adapters = new Map<AdapterId, ProviderAdapter>()
  register(adapter: ProviderAdapter): void {
    if (this.adapters.has(adapter.id)) throw new Error('Provider adapter already registered')
    this.adapters.set(adapter.id, adapter)
  }
  get(id: AdapterId): ProviderAdapter {
    const adapter = this.adapters.get(id)
    if (!adapter) throw new HttpError(422, 'ADAPTER_UNAVAILABLE', 'This provider adapter is not implemented yet')
    return adapter
  }
}
export const providerAdapters = new ProviderAdapterRegistry()
providerAdapters.register({
  id: 'mock', requiresCredential: false,
  async testConnection() { throw new HttpError(422, 'MOCK_PROVIDER', 'Mock providers do not have a live connection; select a real adapter first') },
  validateConfiguration(models) {
    if (!models.length || models.some(model => !model.trim())) throw new HttpError(422, 'VALIDATION_ERROR', 'Choose at least one model')
  },
})

// Fixed HTTPS endpoints only. Never accept provider URLs from users.
const endpoints = {
  openai: 'https://api.openai.com/v1/models',
  anthropic: 'https://api.anthropic.com/v1/models?limit=1',
  elevenlabs: 'https://api.elevenlabs.io/v1/user',
  stability: 'https://api.stability.ai/v1/user/account',
  runway: 'https://api.dev.runwayml.com/v1/organization',
} as const
for (const id of Object.keys(endpoints) as (keyof typeof endpoints)[]) {
  providerAdapters.register({
    id, requiresCredential: true,
    ...((id === 'openai' || id === 'anthropic') ? { generateText: (apiKey: string, input: TextGenerationInput, options?: ProbeOptions) => generateProviderText(id, apiKey, input, options) } : {}),
    validateConfiguration: models => providerAdapters.get('mock').validateConfiguration(models),
    async testConnection(apiKey, options) {
      const headers: Record<string, string> = { Accept: 'application/json' }
      if (id === 'anthropic') { headers['x-api-key'] = apiKey; headers['anthropic-version'] = '2023-06-01' }
      else if (id === 'elevenlabs') headers['xi-api-key'] = apiKey
      else headers.Authorization = 'Bearer ' + apiKey
      if (id === 'runway') headers['X-Runway-Version'] = '2024-11-06'
      await probe(endpoints[id], headers, body => {
        if (id === 'openai' || id === 'anthropic') return Array.isArray(body.data)
        if (id === 'elevenlabs') return typeof body.user_id === 'string'
        if (id === 'stability') return typeof body.id === 'string'
        return typeof body.creditBalance === 'number'
      }, options)
    },
  })
}
