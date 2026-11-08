import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import type { ServerConfig } from '../config/env.js'

/** No connections are opened until a query or explicit $connect(). */
export function createDatabaseAdapter(config: Pick<ServerConfig, 'databaseUrl'>) {
  return new PrismaPg({ connectionString: config.databaseUrl, connectionTimeoutMillis: 5000, max: 10 })
}

/** One owned client per application, injected into services; never per request.
 * Call $disconnect() from the owning application's shutdown hook.
 * Services MUST filter reads/writes by the authenticated userId. Composite FKs
 * prevent cross-user links but are not a substitute for read authorization.
 */
export function createDatabaseClient(config: Pick<ServerConfig, 'databaseUrl'>) {
  return new PrismaClient({ adapter: createDatabaseAdapter(config), log: [] })
}
