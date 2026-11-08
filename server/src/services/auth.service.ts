import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import type { ServerConfig } from '../config/env.js'
import { AuthRepository } from '../database/auth.repository.js'
import { HttpError } from '../middleware/errors.js'
import { hashPassword, verifyPassword } from './password.service.js'

export type Profile = NonNullable<Awaited<ReturnType<AuthRepository['profile']>>>
export type AuthSession = NonNullable<Awaited<ReturnType<AuthRepository['session']>>>
export class AuthService {
  private readonly repository: AuthRepository
  constructor(database: PrismaClient, readonly config: ServerConfig, private readonly now: () => Date = () => new Date()) { this.repository = new AuthRepository(database) }
  private digest(purpose: string, value: string) { return createHmac('sha256', Buffer.from(this.config.sessionSecret, 'base64url')).update(`${purpose}:${value}`).digest('hex') }
  tokenHash(token: string) { return this.digest('session', token) }
  csrf(token: string) { return this.digest('csrf', token) }
  private equal(left: string, right: string) { return /^[0-9a-f]{64}$/.test(left) && timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex')) }
  validateSessionCsrf(token: string, header: unknown): void {
    if (typeof header !== 'string' || !this.equal(header, this.csrf(token))) throw new HttpError(403, 'CSRF_INVALID', 'A valid CSRF token is required')
  }
  anonymousCsrf() {
    const value = `${randomBytes(32).toString('base64url')}.${Math.floor(this.now().getTime() / 1000) + 600}`
    const cookie = `${value}.${this.digest('anonymous', value)}`
    return { cookie, token: this.csrf(cookie) }
  }
  validateAnonymousCsrf(cookie: string | undefined, header: unknown): void {
    const match = cookie?.match(/^([A-Za-z0-9_-]{43})\.(\d{10})\.([0-9a-f]{64})$/)
    if (!match || Number(match[2]) <= Math.floor(this.now().getTime() / 1000) || Number(match[2]) > Math.floor(this.now().getTime() / 1000) + 600 || !this.equal(match[3]!, this.digest('anonymous', `${match[1]}.${match[2]}`))) throw new HttpError(403, 'CSRF_INVALID', 'A valid CSRF token is required')
    this.validateSessionCsrf(cookie!, header)
  }
  authenticate(token: string | undefined) {
    return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? this.repository.session(this.tokenHash(token), this.now(), this.config.sessionIdleMinutes) : Promise.resolve(null)
  }
  private async issue(user: Profile, passwordHash: string, previous?: string) {
    const token = randomBytes(32).toString('base64url')
    const now = this.now()
    const expiresAt = new Date(now.getTime() + this.config.sessionHours * 3600000)
    await this.repository.issueSession(user.id, user.email, passwordHash, this.tokenHash(token), expiresAt, new Date(Math.min(expiresAt.getTime(), now.getTime() + this.config.sessionIdleMinutes * 60000)), now, previous ? this.tokenHash(previous) : undefined)
    return { user, token, expiresAt }
  }
  async register(email: string, displayName: string, password: string, previous?: string) {
    const passwordHash = await hashPassword(password)
    const user = await this.repository.register(email.trim().toLowerCase(), displayName.trim(), passwordHash)
    return this.issue(user, passwordHash, previous)
  }
  async login(email: string, password: string, previous?: string) {
    const credential = await this.repository.credential(email.trim().toLowerCase())
    if (!await verifyPassword(password, credential?.passwordHash ?? null)) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect')
    const { passwordHash, ...user } = credential!
    return this.issue(user, passwordHash!, previous)
  }
  logout(token: string) { return this.repository.revoke(this.tokenHash(token)) }
  logoutAll(userId: string) { return this.repository.revokeAll(userId) }
  async profile(userId: string) {
    const user = await this.repository.profile(userId)
    if (!user) throw new HttpError(401, 'UNAUTHORIZED', 'Authentication is required')
    return user
  }
  async updateProfile(userId: string, data: { displayName?: string; email?: string; currentPassword?: string }) {
    const changed: { displayName?: string; email?: string } = {}
    if (data.displayName !== undefined) changed.displayName = data.displayName.trim()
    let expectedHash: string | undefined
    if (data.email !== undefined) {
      const user = await this.profile(userId)
      const email = data.email.trim().toLowerCase()
      if (email !== user.email) {
        const credential = await this.repository.credential(user.email)
        if (!data.currentPassword || !await verifyPassword(data.currentPassword, credential?.passwordHash ?? null)) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Current password is incorrect')
        expectedHash = credential!.passwordHash!
        changed.email = email
      }
    }
    const user = await this.repository.updateProfile(userId, changed, expectedHash)
    return { user, reauthenticate: !!changed.email }
  }
  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.profile(userId)
    const credential = await this.repository.credential(user.email)
    if (!await verifyPassword(currentPassword, credential?.passwordHash ?? null)) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Current password is incorrect')
    await this.repository.updateProfile(userId, { passwordHash: await hashPassword(newPassword) }, credential!.passwordHash!)
  }
}
