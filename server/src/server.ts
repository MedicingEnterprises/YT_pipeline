import { buildApp } from './app.js'
import { loadConfig } from './config/env.js'

async function main(): Promise<void> {
  const config = loadConfig()
  const app = buildApp(config)
  let closing = false
  const shutdown = async (signal: string) => {
    if (closing) return
    closing = true
    app.log.info({ signal }, 'Shutting down server')
    const deadline = setTimeout(() => process.exit(1), 10000)
    deadline.unref()
    try { await app.close() } catch (err) {
      app.log.error({ err }, 'Server shutdown failed')
      process.exitCode = 1
    } finally { clearTimeout(deadline) }
  }
  process.once('SIGINT', () => { void shutdown('SIGINT') })
  process.once('SIGTERM', () => { void shutdown('SIGTERM') })
  try {
    await app.listen({ host: config.host, port: config.port })
  } catch (err) {
    app.log.error({ err }, 'Server startup failed')
    await app.close()
    process.exitCode = 1
  }
}

void main().catch(() => {
  // Config errors must never accidentally log connection strings or secrets.
  process.stderr.write('Backend startup failed. Check environment configuration.\n')
  process.exitCode = 1
})
