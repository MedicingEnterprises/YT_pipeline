import { Prisma, type PrismaClient } from '@prisma/client'
import { HttpError } from '../middleware/errors.js'
import { resources, type Resource } from '../schemas/resources.js'

export type Row = Record<string, unknown> & { id: string; userId: string }
export type Data = Record<string, unknown>
// Dynamic resource dispatch is contained here; names and writable fields come only
// from the server-owned registry. Prisma still validates every query at runtime.
interface Delegate {
  findFirst(args: Data): Promise<Row | null>
  findMany(args: Data): Promise<Row[]>
  count(args: Data): Promise<number>
  create(args: Data): Promise<Row>
  update(args: Data): Promise<Row>
  updateMany(args: Data): Promise<{ count: number }>
  delete(args: Data): Promise<Row>
  deleteMany(args: Data): Promise<{ count: number }>
}
export class WorkspaceRepository {
  constructor(readonly db: Prisma.TransactionClient) {}
  table(resource: Resource | 'preferences' | 'jobEvents' | 'assignments'): Delegate {
    const key = resource === 'preferences' ? 'userPreferences' : resource === 'jobEvents' ? 'jobEvent' : resource === 'assignments' ? 'pipelineChannel' : resources[resource].delegate
    return (this.db as unknown as Record<string, Delegate>)[key]!
  }
  async require(resource: Resource | 'preferences', userId: string, id?: string): Promise<Row> {
    const row = await this.table(resource).findFirst({ where: { userId, ...(id ? { id } : {}) } })
    if (!row) throw new HttpError(404, 'NOT_FOUND', 'Resource not found')
    return row
  }
  async existsUser(userId: string): Promise<boolean> {
    return !!await this.db.user.findUnique({ where: { id: userId }, select: { id: true } })
  }
}
export async function writeTransaction<T>(db: PrismaClient, userId: string, work: (repository: WorkspaceRepository) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(async tx => {
        // Serialize mutations for one owner, including cross-record validations.
        const owners = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`)
        if (!owners.length) throw new HttpError(401, 'UNAUTHORIZED', 'A valid user identity is required')
        return work(new WorkspaceRepository(tx))
      }, { isolationLevel: 'Serializable', maxWait: 5000, timeout: 15000 })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034' && attempt < 2) continue
      throw error
    }
  }
}
