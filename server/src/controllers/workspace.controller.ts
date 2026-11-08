import type { FastifyReply, FastifyRequest } from 'fastify'
import { WorkspaceService, type ListQuery } from '../services/workspace.service.js'
import type { Data } from '../database/workspace.repository.js'
import type { Resource } from '../schemas/resources.js'

export type IdRequest = FastifyRequest<{ Params: { id: string } }>
export class WorkspaceController {
  constructor(private readonly service: WorkspaceService) {}
  list(resource: Resource, request: FastifyRequest<{ Querystring: ListQuery }>) { return this.service.list(resource, request.userId!, request.query) }
  get(resource: Resource, request: IdRequest) { return this.service.get(resource, request.userId!, request.params.id) }
  async create(resource: Resource, request: FastifyRequest<{ Body: Data }>, reply: FastifyReply) {
    const result = await this.service.save(resource, request.userId!, request.body)
    const id = (result.data as Data).id
    return reply.code(201).header('Location', `/api/v1/${resource}/${String(id)}`).send(result)
  }
  patch(resource: Resource, request: FastifyRequest<{ Params: { id: string }; Body: Data }>) { return this.service.save(resource, request.userId!, request.body, request.params.id) }
  async remove(resource: Resource, request: IdRequest, reply: FastifyReply) {
    await this.service.remove(resource, request.userId!, request.params.id)
    return reply.code(204).send()
  }
  action(request: FastifyRequest<{ Params: { id: string }; Body: { action: string } }>) { return this.service.jobAction(request.userId!, request.params.id, request.body.action) }
  history(request: FastifyRequest<{ Params: { id: string }; Querystring: { page: number; limit: number } }>) { return this.service.jobHistory(request.userId!, request.params.id, request.query) }
  reorder(request: FastifyRequest<{ Params: { id: string }; Body: { stepIds: string[] } }>) { return this.service.reorder(request.userId!, request.params.id, request.body.stepIds) }
  preferences(request: FastifyRequest) { return this.service.preferences(request.userId!) }
  savePreferences(request: FastifyRequest<{ Body: Data }>) { return this.service.preferences(request.userId!, request.body) }
}
