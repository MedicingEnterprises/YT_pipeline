import { Prisma, type PrismaClient } from '@prisma/client'
import { HttpError } from '../middleware/errors.js'

export const publicUserSelect = { id: true, email: true, displayName: true, createdAt: true, updatedAt: true } as const
export class AuthRepository {
  constructor(private readonly db: PrismaClient) {}
  credential(email: string) { return this.db.user.findUnique({ where: { email }, select: { ...publicUserSelect, passwordHash: true } }) }
  profile(id: string) { return this.db.user.findUnique({ where: { id }, select: publicUserSelect }) }
  async register(email: string, displayName: string, passwordHash: string) {
    try {
      return await this.db.user.create({ data: { email, displayName, passwordHash, preferences: { create: { language: 'en-US' } } }, select: publicUserSelect })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new HttpError(409, 'REGISTRATION_UNAVAILABLE', 'Unable to register with these details')
      throw error
    }
  }
  async issueSession(userId: string, expectedEmail: string, expectedHash: string, tokenHash: string, expiresAt: Date, idleExpiresAt: Date, now: Date, oldTokenHash?: string) {
    return this.db.$transaction(async tx => {
      // Credential checks and session creation serialize with password/profile changes.
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`)
      const current = await tx.user.findFirst({ where: { id: userId, email: expectedEmail, passwordHash: expectedHash }, select: { id: true } })
      if (!current) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect')
      if (oldTokenHash) await tx.session.deleteMany({ where: { tokenHash: oldTokenHash } })
      await tx.session.deleteMany({ where: { userId, OR: [{ expiresAt: { lte: now } }, { idleExpiresAt: { lte: now } }] } })
      return tx.session.create({ data: { userId, tokenHash, expiresAt, idleExpiresAt, createdAt: now, lastSeenAt: now } })
    })
  }
  async session(tokenHash: string, now: Date, idleMinutes: number) {
    const session = await this.db.session.findFirst({ where: { tokenHash, expiresAt: { gt: now }, idleExpiresAt: { gt: now } }, include: { user: { select: publicUserSelect } } })
    if (!session) return null
    const touched = await this.db.session.updateMany({ where: { id: session.id, tokenHash, expiresAt: { gt: now }, idleExpiresAt: { gt: now } }, data: { lastSeenAt: now, idleExpiresAt: new Date(Math.min(session.expiresAt.getTime(), now.getTime() + idleMinutes * 60000)) } })
    return touched.count ? session : null
  }
  revoke(tokenHash: string) { return this.db.session.deleteMany({ where: { tokenHash } }) }
  revokeAll(userId: string) { return this.db.session.deleteMany({ where: { userId } }) }
  async updateProfile(userId: string, data: { displayName?: string; email?: string; passwordHash?: string }, expectedHash?: string) {
    return this.db.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`)
      if (expectedHash) {
        const current = await tx.user.findFirst({ where: { id: userId, passwordHash: expectedHash }, select: { id: true } })
        if (!current) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Current password is incorrect')
      }
      const user = await tx.user.update({ where: { id: userId }, data, select: publicUserSelect })
      if (data.email || data.passwordHash) await tx.session.deleteMany({ where: { userId } })
      return user
    })
  }
  cleanupExpired(now: Date) { return this.db.session.deleteMany({ where: { OR: [{ expiresAt: { lte: now } }, { idleExpiresAt: { lte: now } }] } }) }
}
