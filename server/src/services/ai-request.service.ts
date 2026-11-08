import type { PrismaClient } from '@prisma/client'
import { writeTransaction } from '../database/workspace.repository.js'
import { AIUsageRepository } from '../database/ai-usage.repository.js'
import { HttpError } from '../middleware/errors.js'
import { providerAdapters, type AdapterId } from './providers/adapters.js'
import { validateModelSelection } from './providers/catalog.js'
import { ProviderCredentialService } from './providers/credentials.js'
import type { ProbeOptions } from './providers/http.js'
import type { TextGenerationResult } from './providers/text.js'

export interface AITextRequest { requestId: string; providerId?: string; model?: string; prompt: string; systemPrompt?: string; maxOutputTokens?: number; temperature?: number }
export class AIRequestService {
  constructor(private readonly db: PrismaClient, private readonly encryptionKey?: string, private readonly options: ProbeOptions = {}, private readonly sensitiveValues: readonly string[] = [], private readonly now: () => Date = () => new Date()) {}
  usage(userId: string, query: { page: number; limit: number; requestId?: string }) { return new AIUsageRepository(this.db).list(userId, query, this.now()) }
  async generate(userId: string, input: AITextRequest) {
    const maxOutputTokens = input.maxOutputTokens ?? 512
    if (!/^[0-9a-f-]{36}$/i.test(input.requestId) || typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 12000 || input.systemPrompt !== undefined && (typeof input.systemPrompt !== 'string' || input.systemPrompt.length > 4000) || !Number.isInteger(maxOutputTokens) || maxOutputTokens < 64 || maxOutputTokens > 2048 || input.temperature !== undefined && (!Number.isFinite(input.temperature) || input.temperature < 0 || input.temperature > 1)) throw new HttpError(422, 'VALIDATION_ERROR', 'Invalid text request parameters')
    const at = this.now(), minuteAgo = new Date(at.getTime() - 60000)
    const day = new Date(at); day.setUTCHours(0, 0, 0, 0)
    // Reserve BEFORE any provider call, under the existing per-owner DB lock.
    const reserved = await writeTransaction(this.db, userId, async repo => {
      if (await repo.db.aIUsage.findUnique({ where: { userId_requestId: { userId, requestId: input.requestId } } })) throw new HttpError(409, 'DUPLICATE_AI_REQUEST', 'This request ID has already been used. Inspect usage before retrying')
      const providerId = input.providerId ?? (await repo.db.userPreferences.findUnique({ where: { userId } }))?.textProviderId
      if (!providerId) throw new HttpError(422, 'PROVIDER_REQUIRED', 'Select a provider or configure a default text provider')
      const provider = await repo.db.aIProvider.findFirst({ where: { userId, id: providerId }, include: { credential: true } })
      if (!provider) throw new HttpError(404, 'NOT_FOUND', 'Resource not found')
      if (!provider.enabled || !provider.connected || provider.category !== 'TEXT_GENERATION') throw new HttpError(422, 'PROVIDER_NOT_READY', 'Choose an enabled, connected text provider')
      const adapter = providerAdapters.get(provider.adapterId as AdapterId)
      if (!adapter.generateText) throw new HttpError(422, 'TEXT_GENERATION_UNSUPPORTED', 'This provider does not support text generation')
      const model = input.model ?? provider.models[0]
      if (!model || !provider.models.includes(model)) throw new HttpError(422, 'MODEL_UNAVAILABLE', 'Choose a model configured on this provider')
      validateModelSelection(provider.adapterId, provider.category, [model])
      if (!provider.credential) throw new HttpError(422, 'PROVIDER_KEY_MISSING', 'Save an API key before generating text')
      if (provider.adapterId === 'anthropic' && input.temperature !== undefined) throw new HttpError(422, 'UNSUPPORTED_PARAMETER', 'Temperature is not supported for the configured Anthropic model')
      await repo.db.aIUsage.updateMany({ where: { userId, status: 'PROCESSING', requestedAt: { lt: minuteAgo } }, data: { status: 'UNKNOWN', completedAt: at, errorCode: 'OUTCOME_UNKNOWN' } })
      if (await repo.db.aIUsage.count({ where: { userId, status: 'PROCESSING' } })) throw new HttpError(409, 'AI_REQUEST_IN_PROGRESS', 'Wait for the current AI request to finish')
      if (await repo.db.aIUsage.count({ where: { userId, requestedAt: { gte: minuteAgo } } }) >= 5 || await repo.db.aIUsage.count({ where: { userId, requestedAt: { gte: day } } }) >= 50) throw new HttpError(429, 'AI_REQUEST_LIMIT', 'AI request limit reached: 5 per minute and 50 per UTC day')
      const usage = await repo.db.aIUsage.create({ data: { userId, requestId: input.requestId, providerId, adapterId: provider.adapterId, model, requestedAt: at } })
      await repo.db.aIProvider.update({ where: { id: providerId, userId }, data: { lastUsedAt: at } })
      return { usage, provider, model }
    })
    let result: TextGenerationResult | undefined, failure: HttpError | undefined
    try {
      const apiKey = new ProviderCredentialService(this.encryptionKey).decrypt(userId, reserved.provider.id, reserved.provider.credential!.envelope)
      const secrets = [apiKey, this.encryptionKey, ...this.sensitiveValues].filter((value): value is string => Boolean(value))
      if (secrets.some(secret => input.prompt.includes(secret) || input.systemPrompt?.includes(secret))) throw new HttpError(422, 'SENSITIVE_PROMPT', 'The prompt contains a server credential and was not sent')
      result = await providerAdapters.get(reserved.provider.adapterId as AdapterId).generateText!(apiKey, { model: reserved.model, prompt: input.prompt, ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}), maxOutputTokens, ...(input.temperature !== undefined ? { temperature: input.temperature } : {}) }, this.options)
      if (secrets.some(secret => result!.text.includes(secret))) throw new HttpError(502, 'PROVIDER_UNSAFE_RESPONSE', 'The provider returned content that cannot be exposed')
    } catch (error) {
      failure = error instanceof HttpError ? error : new HttpError(502, 'AI_REQUEST_FAILED', 'The AI request failed; provider details were suppressed')
    }
    // Never repeat a provider request if recording its outcome fails.
    try {
      await this.db.aIUsage.update({ where: { id: reserved.usage.id, userId }, data: { status: failure ? 'FAILED' : 'SUCCEEDED', completedAt: this.now(), ...(result ? result.usage : {}), errorCode: failure?.code ?? null } })
    } catch { throw new HttpError(503, 'USAGE_PERSISTENCE_FAILED', 'The request outcome could not be recorded. Inspect usage before making another request') }
    if (failure) throw failure
    return { data: { requestId: input.requestId, usageId: reserved.usage.id, providerId: reserved.provider.id, provider: reserved.provider.adapterId, model: reserved.model, text: result!.text, finishReason: result!.finishReason, usage: { ...result!.usage, estimatedCostUsd: null } } }
  }
}
