import { readFileSync, readdirSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { PGlite } from '@electric-sql/pglite'
import pg from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

/** Real Prisma queries against disposable single-connection PostgreSQL SQL.
 * No existing database, connection URL, network listener or workspace is used.
 */
export async function databaseFixture() {
  const engine = new PGlite()
  for (const migration of readdirSync('prisma/migrations', { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()) {
    await engine.exec(readFileSync(`prisma/migrations/${migration}/migration.sql`, 'utf8'))
  }
  const pool = new pg.Pool()
  type Query = { text: string; values?: unknown[]; rowMode?: 'array' | 'object'; types?: { getTypeParser: (oid: number, format: 'text') => (text: string) => unknown } }
  const query = async (config: string | Query, values: unknown[] = []) => {
    const text = typeof config === 'string' ? config : config.text
    const parameters = typeof config === 'string' ? values : config.values ?? []
    const oids = [16, 17, 20, 21, 23, 25, 26, 114, 700, 701, 1042, 1043, 1082, 1083, 1114, 1184, 1186, 1266, 1700, 2950, 3802, 1009, 1015, 1007, 1016, 1231]
    const parsers = typeof config !== 'string' && config.types ? Object.fromEntries(oids.map(oid => [oid, config.types!.getTypeParser(oid, 'text')])) : {}
    const result = await engine.query(text, parameters, { rowMode: typeof config === 'string' ? 'object' : config.rowMode ?? 'object', parsers })
    return { rows: result.rows, fields: result.fields, rowCount: result.affectedRows ?? result.rows.length }
  }
  pool.query = query as typeof pool.query
  pool.connect = (async () => Object.assign(new EventEmitter(), { query, release: () => {} })) as unknown as typeof pool.connect
  const database = new PrismaClient({ adapter: new PrismaPg(pool) })
  return { database, close: async () => { await database.$disconnect(); await pool.end(); await engine.close() } }
}
