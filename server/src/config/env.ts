export interface ServerConfig {
  nodeEnv: 'development' | 'test' | 'production'
  host: string
  port: number
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent'
  databaseUrl: string
  providerEncryptionKey?: string
  sessionSecret: string
  sessionHours: number
  sessionIdleMinutes: number
  secureCookies: boolean
  allowedOrigins: string[]
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const nodeEnv = env.NODE_ENV ?? 'development'
  const logLevel = env.LOG_LEVEL ?? 'info'
  const rawPort = env.PORT ?? '3001'
  const host = env.HOST?.trim() ?? '127.0.0.1'
  if (!['development', 'test', 'production'].includes(nodeEnv)) throw new Error('Invalid NODE_ENV')
  if (!['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'].includes(logLevel)) throw new Error('Invalid LOG_LEVEL')
  if (!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) throw new Error('PORT must be an integer between 1 and 65535')
  if (!host) throw new Error('HOST is required')
  const databaseUrl = env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is required')
  try {
    const parsed = new URL(databaseUrl)
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || parsed.pathname.length < 2) throw new Error()
  } catch {
    // Never include the supplied URL or credentials in errors.
    throw new Error('DATABASE_URL must be a PostgreSQL connection URL with a database name')
  }
  if (env.DEV_USER_ID) throw new Error('DEV_USER_ID is no longer supported; use a registered account')
  const sessionSecret = env.SESSION_SECRET ?? ''
  if (!/^[A-Za-z0-9_-]{43}$/.test(sessionSecret) || Buffer.from(sessionSecret, 'base64url').length !== 32 || Buffer.from(sessionSecret, 'base64url').toString('base64url') !== sessionSecret) throw new Error('SESSION_SECRET must be 32 random bytes encoded as base64url')
  const bounded = (value: string | undefined, fallback: number, max: number): number => {
    if (value !== undefined && (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max)) throw new Error('Invalid session timeout configuration')
    return value === undefined ? fallback : Number(value)
  }
  const sessionHours = bounded(env.SESSION_HOURS, 24, 168)
  const sessionIdleMinutes = bounded(env.SESSION_IDLE_MINUTES, 30, 1440)
  if (env.SESSION_COOKIE_SECURE && !['true', 'false'].includes(env.SESSION_COOKIE_SECURE)) throw new Error('Invalid SESSION_COOKIE_SECURE')
  const secureCookies = nodeEnv === 'production' || env.SESSION_COOKIE_SECURE === 'true'
  if (nodeEnv === 'production' && env.SESSION_COOKIE_SECURE === 'false') throw new Error('Production session cookies require HTTPS')
  if (!secureCookies && !['localhost', '127.0.0.1', '::1'].includes(host)) throw new Error('Insecure development cookies require a loopback host')
  if (nodeEnv === 'production' && !env.APP_ORIGINS) throw new Error('Production requires explicit APP_ORIGINS')
  const allowedOrigins = (env.APP_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:3001,http://127.0.0.1:3001').split(',').map(value => value.trim())
  if (!allowedOrigins.length || allowedOrigins.some(value => {
    try { const url = new URL(value); return url.origin !== value || !['http:', 'https:'].includes(url.protocol) || nodeEnv === 'production' && url.protocol !== 'https:' } catch { return true }
  })) throw new Error('APP_ORIGINS must contain exact HTTP(S) origins; production requires HTTPS')
  const providerEncryptionKey = env.PROVIDER_ENCRYPTION_KEY
  if (providerEncryptionKey !== undefined && (!/^[A-Za-z0-9_-]{43}$/.test(providerEncryptionKey) || Buffer.from(providerEncryptionKey, 'base64url').toString('base64url') !== providerEncryptionKey)) throw new Error('PROVIDER_ENCRYPTION_KEY must be 32 random bytes encoded as base64url')
  return { ...(providerEncryptionKey ? { providerEncryptionKey } : {}), nodeEnv: nodeEnv as ServerConfig['nodeEnv'], host, port: Number(rawPort), logLevel: logLevel as ServerConfig['logLevel'], databaseUrl, sessionSecret, sessionHours, sessionIdleMinutes, secureCookies, allowedOrigins: [...new Set(allowedOrigins)] }
}
