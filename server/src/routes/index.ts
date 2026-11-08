import type { FastifyPluginAsync } from 'fastify'
import { healthController } from '../controllers/health.controller.js'
import { healthSchema } from '../schemas/health.schema.js'
import { openApiDocument } from '../schemas/openapi.js'

export const routes: FastifyPluginAsync = async app => {
  app.get('/health', { schema: healthSchema }, healthController)
  app.get('/openapi.json', async () => openApiDocument())
}
