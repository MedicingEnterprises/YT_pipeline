import type { PrismaClient } from '@prisma/client'

/** Usage snapshots intentionally survive provider removal and workspace resets. */
export class AIUsageRepository {
  constructor(private readonly db: PrismaClient) {}
  async list(userId: string, query: { page: number; limit: number; requestId?: string }, now: Date) {
    return this.db.$transaction(async tx => {
      const where = { userId, ...(query.requestId ? { requestId: query.requestId } : {}) }
      const total = await tx.aIUsage.count({ where })
      const rows = await tx.aIUsage.findMany({ where, orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.limit, take: query.limit })
      return { data: rows.map(row => ({ ...row, status: row.status === 'PROCESSING' && now.getTime() - row.requestedAt.getTime() > 60000 ? 'UNKNOWN' : row.status })), pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } }
    }, { isolationLevel: 'RepeatableRead' })
  }
}
