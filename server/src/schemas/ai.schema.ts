import { objectSchema, uuid } from './resources.js'

export const textRequestSchema = objectSchema({
  requestId: uuid, providerId: uuid,
  model: { type: 'string', minLength: 1, maxLength: 100 },
  prompt: { type: 'string', minLength: 1, maxLength: 12000, pattern: '\\S' },
  systemPrompt: { type: 'string', maxLength: 4000 },
  maxOutputTokens: { type: 'integer', minimum: 64, maximum: 2048, default: 512 },
  temperature: { type: 'number', minimum: 0, maximum: 1 },
}, ['requestId', 'prompt'])
export const usageQuerySchema = objectSchema({
  page: { type: 'integer', minimum: 1, maximum: 100000, default: 1 },
  limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
  requestId: uuid,
})
