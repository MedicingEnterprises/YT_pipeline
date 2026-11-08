import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { HttpError } from '../middleware/errors.js'

const N = 131072, r = 8, p = 1
// Bound concurrent memory-hard operations, including requests from different IPs.
let active = 0
const waiters: Array<() => void> = []
async function derive(password: string, salt: Buffer): Promise<Buffer> {
  if (active >= 2) {
    if (waiters.length >= 8) throw new HttpError(503, 'AUTH_BUSY', 'Authentication is busy; try again shortly')
    await new Promise<void>(resolve => waiters.push(resolve))
  } else active++
  try {
    return await new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 64, { N, r, p, maxmem: 256 * 1024 * 1024 }, (error, result) => error ? reject(error) : resolve(result)))
  } finally {
    const next = waiters.shift()
    if (next) next(); else active--
  }
}
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await derive(password, salt)
  return `scrypt$${N}$${r}$${p}$${salt.toString('hex')}$${key.toString('hex')}`
}
export async function verifyPassword(password: string, hash: string | null): Promise<boolean> {
  const match = hash?.match(/^scrypt\$131072\$8\$1\$([0-9a-f]{32})\$([0-9a-f]{128})$/)
  // Unknown/legacy accounts perform the same expensive operation as known ones.
  const salt = match ? Buffer.from(match[1]!, 'hex') : Buffer.alloc(16)
  const expected = match ? Buffer.from(match[2]!, 'hex') : Buffer.alloc(64)
  const actual = await derive(password, salt)
  return timingSafeEqual(actual, expected) && !!match
}
