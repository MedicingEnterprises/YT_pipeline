import type { FastifyPluginAsync } from 'fastify'
import type { AuthService } from '../services/auth.service.js'
import { AuthController } from '../controllers/auth.controller.js'
import { anonymousGuard, credentialTypes, sessionGuard } from '../middleware/session.js'
import { loginSchema, passwordSchema, profileSchema, registerSchema } from '../schemas/auth.schema.js'

export const authRoutes: FastifyPluginAsync<{ auth: AuthService }> = async (app, { auth }) => {
  const controller = new AuthController(auth)
  app.addHook('preValidation', credentialTypes)
  app.addHook('onSend', async (_request, reply, payload) => { reply.header('Cache-Control', 'no-store'); return payload })
  const credentialsLimit = { max: 10, timeWindow: 15 * 60 * 1000, groupId: 'auth-credentials' }
  app.get('/csrf', { config: { rateLimit: { max: 60, timeWindow: 60000 } } }, (request, reply) => controller.csrf(request, reply))
  app.post<{ Body: { email: string; displayName: string; password: string } }>('/register', { schema: { body: registerSchema }, preHandler: anonymousGuard(auth), config: { rateLimit: credentialsLimit } }, (request, reply) => controller.register(request, reply))
  app.post<{ Body: { email: string; password: string } }>('/login', { schema: { body: loginSchema }, preHandler: anonymousGuard(auth), config: { rateLimit: credentialsLimit } }, (request, reply) => controller.login(request, reply))
  app.post('/logout', { preHandler: sessionGuard(auth), config: { rateLimit: { max: 30, timeWindow: 60000 } } }, (request, reply) => controller.logout(request, reply))
  app.post('/logout-all', { preHandler: sessionGuard(auth), config: { rateLimit: credentialsLimit } }, (request, reply) => controller.logout(request, reply, true))
  app.get('/me', { preHandler: sessionGuard(auth) }, request => controller.me(request))
  app.patch<{ Body: { displayName?: string; email?: string; currentPassword?: string } }>('/me', { schema: { body: profileSchema }, preHandler: sessionGuard(auth), config: { rateLimit: credentialsLimit } }, (request, reply) => controller.update(request, reply))
  app.put<{ Body: { currentPassword: string; newPassword: string } }>('/password', { schema: { body: passwordSchema }, preHandler: sessionGuard(auth), config: { rateLimit: credentialsLimit } }, (request, reply) => controller.password(request, reply))
}
