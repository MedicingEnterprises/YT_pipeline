import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify'
import type { ServerConfig } from '../config/env.js'
import type { AuthSession, AuthService } from '../services/auth.service.js'
import { HttpError } from './errors.js'

declare module 'fastify' { interface FastifyRequest { userId: string | null; session: AuthSession | null } }
export const cookieNames = (config: ServerConfig) => ({ session: config.secureCookies ? '__Host-content-hub-session' : 'content-hub-session', csrf: config.secureCookies ? '__Host-content-hub-csrf' : 'content-hub-csrf' })
export const cookieOptions = (config: ServerConfig) => ({ httpOnly: true, secure: config.secureCookies, sameSite: 'lax' as const, path: '/' })
export function clearCookies(reply: FastifyReply, config: ServerConfig) {
  const names = cookieNames(config)
  reply.clearCookie(names.session, cookieOptions(config))
  reply.clearCookie(names.csrf, cookieOptions(config))
}
export function sessionGuard(auth: AuthService): preHandlerHookHandler {
  return async (request, reply) => {
    const raw = request.cookies[cookieNames(auth.config).session]
    const session = await auth.authenticate(raw)
    if (!session) {
      clearCookies(reply, auth.config)
      throw new HttpError(401, 'UNAUTHORIZED', 'Authentication is required')
    }
    request.session = session
    request.userId = session.userId
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) auth.validateSessionCsrf(raw!, request.headers['x-csrf-token'])
  }
}
export function anonymousGuard(auth: AuthService): preHandlerHookHandler {
  return async request => {
    const names = cookieNames(auth.config)
    const session = await auth.authenticate(request.cookies[names.session])
    if (session) auth.validateSessionCsrf(request.cookies[names.session]!, request.headers['x-csrf-token'])
    else auth.validateAnonymousCsrf(request.cookies[names.csrf], request.headers['x-csrf-token'])
  }
}
export async function credentialTypes(request: FastifyRequest) {
  if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) return
  for (const key of ['email', 'displayName', 'password', 'currentPassword', 'newPassword']) {
    const value = (request.body as Record<string, unknown>)[key]
    if (value !== undefined && (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 512)) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid credential or profile field')
  }
}
