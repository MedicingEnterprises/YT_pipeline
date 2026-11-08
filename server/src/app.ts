import type { ProbeOptions } from './services/providers/http.js'
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import type { ServerConfig } from './config/env.js'
import { HttpError, registerErrorHandling } from './middleware/errors.js'
import { routes } from './routes/index.js'
import { createDatabaseClient } from './database/index.js'
import { workspaceRoutes } from './routes/workspace.routes.js'
import { AuthService } from './services/auth.service.js'
import { authRoutes } from './routes/auth.routes.js'

declare module 'fastify' {
  interface FastifyInstance {
    database: ReturnType<typeof createDatabaseClient>
  }
}

export function buildApp(config: ServerConfig, options: { database?: ReturnType<typeof createDatabaseClient>; now?: () => Date; providerProbe?: ProbeOptions } = {}) {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]', 'req.body', 'prompt', 'systemPrompt', 'text', '*.prompt', '*.systemPrompt', '*.text', 'apiKey', '*.apiKey', 'providerEncryptionKey', '*.providerEncryptionKey', 'envelope', '*.envelope', 'password', 'passwordHash', 'currentPassword', 'newPassword', 'sessionSecret', 'token', 'tokenHash', 'csrfToken', 'databaseUrl', '*.password', '*.passwordHash', '*.currentPassword', '*.newPassword', '*.sessionSecret', '*.token', '*.tokenHash', '*.csrfToken', '*.databaseUrl'],
      // Deliberately omit query strings, headers, bodies and raw error messages.
      // Prisma/driver errors can contain query values or connection credentials.
      serializers: {
        req: (request: { method: string; url: string }) => ({ method: request.method, url: request.url.split('?')[0] ?? '/' }),
        err: (error: unknown) => ({ type: error instanceof Error ? error.name : 'Error', message: 'Internal error; details suppressed', stack: '' }),
      },
    },
    // Use server-generated request IDs rather than trusting client headers.
    requestIdHeader: false,
    bodyLimit: 1024 * 1024,
    ajv: { customOptions: { removeAdditional: false } },
  })
  registerErrorHandling(app)
  app.register(cookie)
  app.register(helmet, { strictTransportSecurity: config.nodeEnv === 'production' ? { maxAge: 31536000 } : false })
  app.register(cors, {
    origin: (origin, callback) => {
      if (!origin) return callback(null, false)
      if (!config.allowedOrigins.includes(origin)) return callback(new HttpError(403, 'ORIGIN_FORBIDDEN', 'Origin is not permitted'), false)
      return callback(null, true)
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
    maxAge: 600,
  })
  app.register(rateLimit, { global: false, max: 10, timeWindow: 15 * 60 * 1000, cache: 10000 })
  app.decorateRequest('userId', null)
  app.decorateRequest('session', null)
  const database = options.database ?? createDatabaseClient(config)
  app.decorate('database', database)
  app.addHook('onClose', async () => { await database.$disconnect() })
  app.register(routes)
  const auth = new AuthService(database, config, options.now)
  app.register(authRoutes, { prefix: '/api/v1/auth', auth })
  app.register(workspaceRoutes, { prefix: '/api/v1', auth, sensitiveValues: [config.sessionSecret], ...(options.now ? { now: options.now } : {}), ...(options.providerProbe ? { providerProbe: options.providerProbe } : {}), ...(config.providerEncryptionKey ? { encryptionKey: config.providerEncryptionKey } : {}) })
  return app
}
