import type { PrismaClient } from '@prisma/client'
import { writeTransaction } from '../../database/workspace.repository.js'
import { HttpError } from '../../middleware/errors.js'
import { providerAdapters, type AdapterId } from './adapters.js'
import { ProviderCredentialService } from './credentials.js'
import { providerCatalog } from './catalog.js'
import type { ProbeOptions } from './http.js'

export class ProviderConnectionService {
  private readonly running = new Set<string>()
  constructor(private readonly db: PrismaClient, private readonly encryptionKey?: string, private readonly options: ProbeOptions = {}) {}
  catalog() { return { data: { source: 'maintained', reviewedAt: '2026-11-08', accountAccessVerified: false, providers: providerCatalog } } }
  async test(userId: string, id: string) {
    const key = `${userId}:${id}`
    if (this.running.has(key)) throw new HttpError(409, 'TEST_IN_PROGRESS', 'A connection test is already running for this provider')
    this.running.add(key)
    try {
      const provider = await this.db.aIProvider.findFirst({ where: { id, userId }, include: { credential: true } })
      if (!provider) throw new HttpError(404, 'NOT_FOUND', 'Resource not found')
      const adapter = providerAdapters.get(provider.adapterId as AdapterId)
      if (!provider.enabled) throw new HttpError(422, 'PROVIDER_DISABLED', 'Enable the provider before testing its connection')
      if (!adapter.requiresCredential) await adapter.testConnection('', this.options)
      if (!provider.credential) throw new HttpError(422, 'PROVIDER_KEY_MISSING', 'Save an API key before testing the connection')
      const apiKey = new ProviderCredentialService(this.encryptionKey).decrypt(userId, id, provider.credential.envelope)
      let failure: HttpError | undefined
      try { await adapter.testConnection(apiKey, this.options) } catch (error) {
        failure = error instanceof HttpError ? error : new HttpError(502, 'PROVIDER_CONNECTION_FAILED', 'Could not verify the provider connection')
      }
      const connectedAt = new Date()
      await writeTransaction(this.db, userId, async repo => {
        const current = await repo.db.aIProvider.findFirst({ where: { id, userId }, include: { credential: true } })
        if (!current) throw new HttpError(404, 'NOT_FOUND', 'Resource not found')
        if (current.updatedAt.getTime() !== provider.updatedAt.getTime() || current.credential?.envelope !== provider.credential!.envelope) throw new HttpError(409, 'PROVIDER_CHANGED', 'Provider configuration changed during the test. Test it again')
        await repo.db.aIProvider.update({ where: { id, userId }, data: { connected: !failure, ...(!failure ? { lastConnectedAt: connectedAt } : {}) } })
        await repo.db.activity.create({ data: { userId, providerId: id, category: failure ? 'WARNING' : 'SUCCESS', title: failure ? 'Provider connection failed' : 'Provider connection verified', detail: failure ? failure.code : 'Authenticated provider connection verified' } })
      })
      if (failure) throw failure
      return { data: { id, connected: true, lastConnectedAt: connectedAt.toISOString(), message: 'Provider connection verified. Model generation access has not been tested.' } }
    } finally { this.running.delete(key) }
  }
}
