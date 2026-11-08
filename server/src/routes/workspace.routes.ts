import type { FastifyPluginAsync } from 'fastify'
import type { Data } from '../database/workspace.repository.js'
import { WorkspaceController } from '../controllers/workspace.controller.js'
import { WorkspaceService, type ListQuery } from '../services/workspace.service.js'
import { sessionGuard } from '../middleware/session.js'
import type { AuthService } from '../services/auth.service.js'
import { bodySchema, idParams, jobActionSchema, listSchema, objectSchema, preferencesSchema, reorderSchema, resources, pipelineConfigurationSchema, type Resource } from '../schemas/resources.js'
import { importSchema } from '../schemas/import.schema.js'
import { WorkspaceSyncController } from '../controllers/workspace-sync.controller.js'
import { WorkspaceSyncService, type ImportData } from '../services/workspace-sync.service.js'

export const workspaceRoutes: FastifyPluginAsync<{ auth: AuthService }> = async (app, options) => {
  app.addHook('preHandler', sessionGuard(options.auth))
  app.addHook('onSend', async (_request, reply, payload) => { reply.header('Cache-Control', 'no-store'); return payload })
  const controller = new WorkspaceController(new WorkspaceService(app.database))
  const sync = new WorkspaceSyncController(new WorkspaceSyncService(app.database), new WorkspaceService(app.database))
  app.get('/workspace', request => sync.snapshot(request))
  app.post('/workspace/reset', { schema: { body: objectSchema({ confirmation: { const: 'RESET', type: 'string' } }, ['confirmation']) } }, request => sync.reset(request))
  app.post<{ Body: ImportData }>('/workspace/import/preview', { bodyLimit: 5 * 1024 * 1024, schema: { body: importSchema } }, request => sync.preview(request))
  app.post<{ Body: ImportData }>('/workspace/import', { bodyLimit: 5 * 1024 * 1024, schema: { body: importSchema } }, request => sync.import(request))
  app.put<{ Params: { id: string }; Body: Data }>('/pipelines/:id/configuration', { schema: { params: idParams, body: pipelineConfigurationSchema } }, request => sync.configure(request))
  for (const resource of Object.keys(resources) as Resource[]) {
    const path = `/${resource}`
    app.get<{ Querystring: ListQuery }>(path, { schema: { querystring: listSchema(resource) } }, request => controller.list(resource, request))
    app.get<{ Params: { id: string } }>(`${path}/:id`, { schema: { params: idParams } }, request => controller.get(resource, request))
    if (resource === 'activity') continue // Immutable audit history is service-generated.
    app.post<{ Body: Data }>(path, { schema: { body: bodySchema(resource, false) } }, (request, reply) => controller.create(resource, request, reply))
    app.delete<{ Params: { id: string } }>(`${path}/:id`, { schema: { params: idParams } }, (request, reply) => controller.remove(resource, request, reply))
    if (resource === 'jobs') {
      app.patch<{ Params: { id: string }; Body: { action: string } }>(`${path}/:id`, { schema: { params: idParams, body: jobActionSchema } }, request => controller.action(request))
    } else {
      app.patch<{ Params: { id: string }; Body: Data }>(`${path}/:id`, { schema: { params: idParams, body: bodySchema(resource, true) } }, request => controller.patch(resource, request))
    }
  }
  app.put<{ Params: { id: string }; Body: { stepIds: string[] } }>('/pipelines/:id/steps/order', { schema: { params: idParams, body: reorderSchema } }, request => controller.reorder(request))
  app.get<{ Params: { id: string }; Querystring: { page: number; limit: number } }>('/jobs/:id/history', { schema: { params: idParams, querystring: objectSchema({ page: { type: 'integer', minimum: 1, maximum: 100000, default: 1 }, limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 } }) } }, request => controller.history(request))
  app.get('/preferences', request => controller.preferences(request))
  app.patch<{ Body: Data }>('/preferences', { schema: { body: { ...preferencesSchema, minProperties: 1 } } }, request => controller.savePreferences(request))
}
