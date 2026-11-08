import type { FastifyRequest } from 'fastify'
import type { ProviderConnectionService } from '../services/providers/connections.js'

export class ProviderConnectionController {
  constructor(private readonly service: ProviderConnectionService) {}
  catalog() { return this.service.catalog() }
  test(request: FastifyRequest<{ Params: { id: string } }>) {
    return this.service.test(request.userId!, request.params.id)
  }
}
