import type { FastifyRequest } from 'fastify'
import type { WorkspaceSyncService, ImportData } from '../services/workspace-sync.service.js'
import type { WorkspaceService } from '../services/workspace.service.js'
import type { Data } from '../database/workspace.repository.js'
export class WorkspaceSyncController {
  constructor(private readonly sync: WorkspaceSyncService, private readonly workspace: WorkspaceService) {}
  snapshot(request: FastifyRequest) { return this.sync.snapshot(request.userId!) }
  reset(request: FastifyRequest) { return this.sync.reset(request.userId!) }
  preview(request: FastifyRequest<{ Body: ImportData }>) { return this.sync.preview(request.userId!, request.body) }
  import(request: FastifyRequest<{ Body: ImportData }>) { return this.sync.import(request.userId!, request.body) }
  configure(request: FastifyRequest<{ Params: { id: string }; Body: Data }>) { return this.workspace.configurePipeline(request.userId!, request.params.id, request.body) }
}
