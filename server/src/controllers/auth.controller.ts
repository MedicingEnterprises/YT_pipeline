import type { FastifyReply, FastifyRequest } from 'fastify'
import type { AuthService } from '../services/auth.service.js'
import { clearCookies, cookieNames, cookieOptions } from '../middleware/session.js'

export class AuthController {
  constructor(private readonly auth: AuthService) {}
  async csrf(request: FastifyRequest, reply: FastifyReply) {
    const names = cookieNames(this.auth.config)
    const token = request.cookies[names.session]
    const session = await this.auth.authenticate(token)
    if (session) return { data: { csrfToken: this.auth.csrf(token!) } }
    const anonymous = this.auth.anonymousCsrf()
    reply.setCookie(names.csrf, anonymous.cookie, { ...cookieOptions(this.auth.config), maxAge: 600 })
    return { data: { csrfToken: anonymous.token } }
  }
  private setSession(reply: FastifyReply, issued: Awaited<ReturnType<AuthService['login']>>) {
    const names = cookieNames(this.auth.config)
    reply.setCookie(names.session, issued.token, { ...cookieOptions(this.auth.config), expires: issued.expiresAt })
    reply.clearCookie(names.csrf, cookieOptions(this.auth.config))
    return { data: { user: issued.user, expiresAt: issued.expiresAt } }
  }
  async register(request: FastifyRequest<{ Body: { email: string; displayName: string; password: string } }>, reply: FastifyReply) {
    const { email, displayName, password } = request.body
    const issued = await this.auth.register(email, displayName, password, request.cookies[cookieNames(this.auth.config).session])
    return reply.code(201).send(this.setSession(reply, issued))
  }
  async login(request: FastifyRequest<{ Body: { email: string; password: string } }>, reply: FastifyReply) {
    const issued = await this.auth.login(request.body.email, request.body.password, request.cookies[cookieNames(this.auth.config).session])
    return this.setSession(reply, issued)
  }
  async logout(request: FastifyRequest, reply: FastifyReply, all = false) {
    if (all) await this.auth.logoutAll(request.userId!)
    else await this.auth.logout(request.cookies[cookieNames(this.auth.config).session]!)
    clearCookies(reply, this.auth.config)
    return reply.code(204).send()
  }
  async me(request: FastifyRequest) { return { data: await this.auth.profile(request.userId!) } }
  async update(request: FastifyRequest<{ Body: { displayName?: string; email?: string; currentPassword?: string } }>, reply: FastifyReply) {
    const updated = await this.auth.updateProfile(request.userId!, request.body)
    if (updated.reauthenticate) clearCookies(reply, this.auth.config)
    return { data: updated.user }
  }
  async password(request: FastifyRequest<{ Body: { currentPassword: string; newPassword: string } }>, reply: FastifyReply) {
    await this.auth.changePassword(request.userId!, request.body.currentPassword, request.body.newPassword)
    clearCookies(reply, this.auth.config)
    return reply.code(204).send()
  }
}
