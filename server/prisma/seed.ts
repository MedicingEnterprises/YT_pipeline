import { createDatabaseClient } from '../src/database/index.js'
import { loadConfig } from '../src/config/env.js'

// Explicit double opt-in. Never guess development from an unset NODE_ENV.
if (process.env.NODE_ENV !== 'development' || process.env.ALLOW_DEV_SEED !== 'true') {
  throw new Error('Seed requires NODE_ENV=development and ALLOW_DEV_SEED=true')
}
const config = loadConfig()
const target = new URL(config.databaseUrl)
if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)) {
  throw new Error('Development seed is restricted to a local PostgreSQL host')
}
const db = createDatabaseClient(config)
const ids = {
  user: '00000000-0000-4000-8000-000000000001',
  channel: '00000000-0000-4000-8000-000000000002',
  provider: '00000000-0000-4000-8000-000000000003',
  pipeline: '00000000-0000-4000-8000-000000000004',
  content: '00000000-0000-4000-8000-000000000005',
  activity: '00000000-0000-4000-8000-000000000006',
}
try {
  // Atomic, repeatable, additive: never delete or overwrite existing workspace data.
  await db.$transaction(async tx => {
    // Deliberately no password hash: sample accounts cannot log in.
    await tx.user.upsert({ where: { id: ids.user }, update: {}, create: { id: ids.user, email: 'demo@example.invalid', displayName: 'Local demo' } })
    const userId = ids.user
    await tx.channel.upsert({ where: { userId_id: { userId, id: ids.channel } }, update: {}, create: { id: ids.channel, userId, name: 'Demo channel', handle: '@local-demo', category: 'Education' } })
    await tx.aIProvider.upsert({ where: { userId_id: { userId, id: ids.provider } }, update: {}, create: { id: ids.provider, userId, name: 'Mock text provider', category: 'TEXT_GENERATION', models: ['mock-text'], connected: false } })
    await tx.pipeline.upsert({ where: { userId_id: { userId, id: ids.pipeline } }, update: {}, create: { id: ids.pipeline, userId, name: 'Mock preparation', description: 'Local sample configuration only; no worker or external API.' } })
    await tx.pipelineChannel.upsert({ where: { userId_pipelineId_channelId: { userId, pipelineId: ids.pipeline, channelId: ids.channel } }, update: {}, create: { userId, pipelineId: ids.pipeline, channelId: ids.channel } })
    const kinds = ['IDEA', 'SCRIPT', 'QUALITY_CHECK'] as const
    for (const [order, kind] of kinds.entries()) {
      const id = `00000000-0000-4000-8000-00000000001${order}`
      await tx.pipelineStep.upsert({ where: { userId_id: { userId, id } }, update: {}, create: { id, userId, pipelineId: ids.pipeline, kind, order, providerId: kind === 'SCRIPT' ? ids.provider : null, instructions: 'Simulate this step only.' } })
    }
    await tx.contentItem.upsert({ where: { userId_id: { userId, id: ids.content } }, update: {}, create: { id: ids.content, userId, channelId: ids.channel, pipelineId: ids.pipeline, title: 'A safe local demo idea', notes: 'No AI credentials or OAuth tokens are included.' } })
    await tx.userPreferences.upsert({ where: { userId }, update: {}, create: { userId, workspaceName: 'Local demo workspace', timezone: 'UTC', defaultChannelId: ids.channel, defaultPipelineId: ids.pipeline, textProviderId: ids.provider } })
    await tx.activity.upsert({ where: { id: ids.activity }, update: {}, create: { id: ids.activity, userId, contentId: ids.content, category: 'SUCCESS', title: 'Development sample created', detail: 'Local mock configuration only.' } })
  })
  console.log('Development sample data is ready.')
} catch {
  // Connection/driver errors can contain credentials; do not print them.
  console.error('Seed failed. Check the local database, migrations and sample record conflicts.')
  process.exitCode = 1
} finally {
  await db.$disconnect()
}
