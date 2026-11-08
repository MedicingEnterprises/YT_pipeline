import type { FastifyRequest } from 'fastify'
import type { AIRequestService, AITextRequest } from '../services/ai-request.service.js'

export class AIController {
  constructor(private readonly service: AIRequestService) {}
  generate(request: FastifyRequest<{ Body: AITextRequest }>) { return this.service.generate(request.userId!, request.body) }
  usage(request: FastifyRequest<{ Querystring: { page: number; limit: number; requestId?: string } }>) { return this.service.usage(request.userId!, request.query) }
}
