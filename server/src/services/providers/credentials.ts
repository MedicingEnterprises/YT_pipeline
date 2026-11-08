import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { HttpError } from '../../middleware/errors.js'

/** Versioned AES-GCM envelope; owner/provider binding prevents ciphertext swapping. */
export class ProviderCredentialService {
  constructor(private readonly masterKey?: string) {}
  private key(): Buffer {
    if (!this.masterKey || !/^[A-Za-z0-9_-]{43}$/.test(this.masterKey) || Buffer.from(this.masterKey, 'base64url').toString('base64url') !== this.masterKey) {
      throw new HttpError(503, 'CREDENTIAL_STORAGE_UNAVAILABLE', 'Provider credential encryption is not configured')
    }
    return Buffer.from(this.masterKey, 'base64url')
  }
  encrypt(userId: string, providerId: string, secret: string): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv)
    cipher.setAAD(Buffer.from(`provider:v1:${userId}:${providerId}`))
    const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
    return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.')
  }
  decrypt(userId: string, providerId: string, envelope: string): string {
    const key = this.key()
    try {
      const [version, iv, tag, ciphertext, extra] = envelope.split('.')
      if (version !== 'v1' || !iv || !tag || !ciphertext || extra !== undefined) throw new Error()
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'))
      decipher.setAAD(Buffer.from(`provider:v1:${userId}:${providerId}`))
      decipher.setAuthTag(Buffer.from(tag, 'base64url'))
      return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8')
    } catch {
      throw new HttpError(503, 'CREDENTIAL_UNAVAILABLE', 'Provider credential could not be decrypted')
    }
  }
  async save(db: Prisma.TransactionClient, userId: string, providerId: string, secret: string | null): Promise<void> {
    if (secret === null) {
      await db.providerCredential.deleteMany({ where: { userId, providerId } })
      return
    }
    if (typeof secret !== 'string' || !secret.trim() || secret.length > 8192) throw new HttpError(422, 'VALIDATION_ERROR', 'Invalid provider credential')
    const envelope = this.encrypt(userId, providerId, secret)
    await db.providerCredential.upsert({ where: { providerId }, create: { userId, providerId, envelope }, update: { envelope } })
  }
}
