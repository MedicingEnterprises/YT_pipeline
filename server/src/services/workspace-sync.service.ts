import { createHash, randomUUID } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { writeTransaction, type Data } from '../database/workspace.repository.js'
import { validatePipeline, validateResource, validateTimezone, availablePipeline, invalid, conflict } from './workspace.validation.js'
import { HttpError } from '../middleware/errors.js'

const json = <T>(data: T): T => JSON.parse(JSON.stringify(data, (_key, value: unknown) => typeof value === 'bigint' ? String(value) : value)) as T
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).sort().join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`
  return JSON.stringify(value)
}
export interface ImportData { version: number; replacePreferences?: boolean; channels: Data[]; providers: Data[]; pipelines: Data[]; content: Data[]; schedules: Data[]; jobs: Data[]; analytics: Data[]; activities: Data[]; preferences: Data }
export class WorkspaceSyncService {
  constructor(private readonly db: PrismaClient) {}
  async snapshot(userId: string) {
    return this.db.$transaction(async tx => {
      const where = { userId }
      const [channels, providers, pipelines, content, schedules, jobs, analytics, activities, preferences] = await Promise.all([
        tx.channel.findMany({ where, take: 10001 }), tx.aIProvider.findMany({ where, take: 10001 }), tx.pipeline.findMany({ where, include: { steps: { orderBy: { order: 'asc' } }, assignments: true }, take: 10001 }), tx.contentItem.findMany({ where, take: 10001 }), tx.schedule.findMany({ where, take: 10001 }), tx.job.findMany({ where, include: { events: { orderBy: { createdAt: 'asc' }, take: 1000 } }, take: 10001 }), tx.analyticsRecord.findMany({ where, take: 10001 }), tx.activity.findMany({ where, orderBy: { createdAt: 'desc' }, take: 10001 }), tx.userPreferences.findUnique({ where: { userId } }),
      ])
      if ([channels, providers, pipelines, content, schedules, jobs, analytics, activities].some(rows => rows.length > 10000)) throw new HttpError(413, 'WORKSPACE_TOO_LARGE', 'Use paginated APIs for this workspace; the prototype snapshot limit is 10000 records per collection')
      if (!preferences) throw new HttpError(404, 'NOT_FOUND', 'Workspace preferences are unavailable')
      return { data: json({ channels, providers, pipelines, content, schedules, jobs, analytics, activities, preferences }) }
    }, { isolationLevel: 'RepeatableRead' })
  }
  async reset(userId: string) {
    return writeTransaction(this.db, userId, async repo => {
      const tx = repo.db
      await tx.activity.deleteMany({ where: { userId } }); await tx.jobEvent.deleteMany({ where: { userId } }); await tx.job.deleteMany({ where: { userId } }); await tx.schedule.deleteMany({ where: { userId } }); await tx.analyticsRecord.deleteMany({ where: { userId } }); await tx.contentItem.deleteMany({ where: { userId } }); await tx.userPreferences.deleteMany({ where: { userId } }); await tx.channel.updateMany({ where: { userId }, data: { defaultPipelineId: null } }); await tx.pipelineStep.deleteMany({ where: { userId } }); await tx.pipelineChannel.deleteMany({ where: { userId } }); await tx.pipeline.deleteMany({ where: { userId } }); await tx.channel.deleteMany({ where: { userId } }); await tx.aIProvider.deleteMany({ where: { userId } }); await tx.userPreferences.create({ data: { userId, language: 'en-US' } })
      // Keep import receipts to prevent an old backup from silently replaying.
      return { data: { reset: true } }
    })
  }
  digest(input: ImportData) { const { replacePreferences: _replace, ...data } = input; return createHash('sha256').update(canonical(data)).digest('hex') }
  async preview(userId: string, input: ImportData) {
    const digest = this.digest(input)
    const previous = await this.db.workspaceImport.findUnique({ where: { userId_digest: { userId, digest } }, select: { id: true } })
    return { data: { digest, alreadyImported: !!previous, counts: Object.fromEntries(Object.entries(input).filter(([, value]) => Array.isArray(value)).map(([key, rows]) => [key, (rows as unknown[]).length])) } }
  }
  async import(userId: string, input: ImportData) {
    const digest = this.digest(input)
    return writeTransaction(this.db, userId, async repo => {
      if (await repo.db.workspaceImport.findUnique({ where: { userId_digest: { userId, digest } } })) conflict('This workspace has already been imported into this account')
      const mapping = new Map<string, Map<string, string>>()
      for (const key of ['channels', 'providers', 'pipelines', 'content', 'schedules', 'jobs', 'analytics', 'activities']) {
        const rows = input[key as keyof ImportData] as Data[]
        const ids = new Map<string, string>()
        for (const row of rows) { const source = String(row.sourceId); if (ids.has(source)) invalid(`Duplicate source ID in ${key}`); ids.set(source, randomUUID()) }
        mapping.set(key, ids)
      }
      const ref = (key: string, id: unknown): string | null => {
        if (id === null || id === undefined || id === '') return null
        const target = mapping.get(key)?.get(String(id)); if (!target) invalid(`Missing ${key} reference: ${String(id).slice(0, 100)}`); return target!
      }
      const fields = (row: Data) => { const { sourceId: _source, ...data } = row; return data }
      for (const row of input.channels) {
        const data = { ...fields(row), id: ref('channels', row.sourceId), userId, defaultPipelineId: null }
        await validateResource(repo, userId, 'channels', data)
        await repo.table('channels').create({ data })
      }
      for (const row of input.providers) { const data = { ...fields(row), id: ref('providers', row.sourceId), userId }; await validateResource(repo, userId, 'ai-providers', data); await repo.table('ai-providers').create({ data }) }
      for (const row of input.pipelines) {
        const { steps, assignedChannelIds, ...values } = fields(row)
        const data = { ...values, id: ref('pipelines', row.sourceId), userId }
        const configuration = (steps as Data[]).map(step => ({ ...fields(step), providerId: ref('providers', step.providerId) }))
        await validateResource(repo, userId, 'pipelines', { ...data, assignedChannelIds: (assignedChannelIds as string[]).map(id => ref('channels', id)) })
        await validatePipeline(repo, userId, data, configuration)
        await repo.table('pipelines').create({ data })
        for (const step of configuration) await repo.table('pipeline-steps').create({ data: { ...step, userId, pipelineId: data.id } })
        for (const channelId of assignedChannelIds as string[]) await repo.table('assignments').create({ data: { userId, channelId: ref('channels', channelId), pipelineId: data.id } })
      }
      for (const row of input.channels) if (row.defaultPipelineId) await repo.table('channels').update({ where: { userId, id: ref('channels', row.sourceId) }, data: { defaultPipelineId: ref('pipelines', row.defaultPipelineId) } })
      for (const row of input.content) {
        const data = { ...fields(row), id: ref('content', row.sourceId), userId, channelId: ref('channels', row.channelId), pipelineId: ref('pipelines', row.pipelineId), publishedAt: row.status === 'PUBLISHED' ? new Date(String(row.updatedAt ?? new Date().toISOString())) : null }
        await validateResource(repo, userId, 'content', data, undefined, 'import')
        await repo.table('content').create({ data })
      }
      const scheduled = new Set<string>()
      for (const row of input.schedules) {
        const contentId = ref('content', row.contentId)!
        if (scheduled.has(contentId)) invalid('Imported content has more than one schedule'); scheduled.add(contentId)
        validateTimezone(row.timezone)
        const scheduledAt = new Date(String(row.scheduledAt))
        const held = scheduledAt.getTime() <= Date.now() || row.status !== 'SCHEDULED'
        const content = await repo.require('content', userId, contentId)
        if (content.status === 'PUBLISHED') invalid('Published content cannot have a pending imported schedule')
        const matching: Record<string, string[]> = { SCHEDULED: ['SCHEDULED'], READY: ['READY'], PROCESSING: ['SCRIPT', 'GENERATING', 'EDITING'], NEEDS_ATTENTION: ['FAILED'] }
        if (!matching[String(row.status)]?.includes(String(content.status))) invalid('Imported schedule and content statuses do not match')
        if (!held) {
          const channel = await repo.require('channels', userId, String(content.channelId))
          if (channel.status !== 'CONNECTED') invalid('Future armed schedules require a mock-connected channel')
          await availablePipeline(repo, userId, content.pipelineId, content.channelId)
        }
        const data = { ...fields(row), userId, id: ref('schedules', row.sourceId), contentId, scheduledAt, status: held ? 'NEEDS_ATTENTION' : 'SCHEDULED' }
        await repo.table('schedules').create({ data })
        await repo.table('content').update({ where: { id: contentId, userId }, data: { status: held ? 'FAILED' : 'SCHEDULED', publishPreference: 'SCHEDULE' } })
        if (!held) {
          const job = await repo.table('jobs').create({ data: { userId, contentId, pipelineId: content.pipelineId, scheduleId: data.id, kind: 'SCHEDULING', type: row.executionMode === 'PIPELINE' ? 'PIPELINE_EXECUTION' : 'SCHEDULED_PUBLICATION', mode: row.executionMode, scheduledAt, idempotencyKey: `import:${digest}:${row.sourceId}` } })
          await repo.table('jobEvents').create({ data: { userId, jobId: job.id, status: 'QUEUED', message: 'Future schedule queued by explicit workspace import' } })
        }
      }
      for (const row of input.content) if (row.status === 'SCHEDULED' && !scheduled.has(ref('content', row.sourceId)!)) invalid('Scheduled content is missing its schedule')
      for (const row of input.jobs) {
        const active = ['QUEUED', 'PROCESSING'].includes(String(row.status))
        const { history, ...values } = fields(row)
        const startedAt = row.startedAt ? new Date(String(row.startedAt)) : null
        const fallbackCompletion = new Date(Math.max(Date.now(), startedAt?.getTime() ?? 0, row.createdAt ? Date.parse(String(row.createdAt)) : 0))
        const data = { ...values, id: ref('jobs', row.sourceId), userId, contentId: ref('content', row.contentId), pipelineId: ref('pipelines', row.pipelineId), providerId: ref('providers', row.providerId), status: active ? 'CANCELLED' : row.status, completedAt: !active && row.completedAt ? new Date(String(row.completedAt)) : fallbackCompletion, startedAt, metadata: { imported: true, originalStatus: row.status }, errorMessage: active ? 'Imported active browser work was cancelled. Queue a new run when a backend worker is available.' : row.errorMessage ?? null }
        const job = await repo.table('jobs').create({ data: { ...data, mode: row.type === 'SCHEDULED_PUBLICATION' ? 'PUBLICATION' : 'PIPELINE' } })
        for (const event of (history ?? []) as Data[]) await repo.table('jobEvents').create({ data: { userId, jobId: job.id, status: event.status, attempt: event.attempt, message: event.message, createdAt: new Date(String(event.at)) } })
        await repo.table('jobEvents').create({ data: { userId, jobId: job.id, status: job.status, attempt: job.attempt, message: active ? String(data.errorMessage) : 'Historical browser job imported', createdAt: data.completedAt } })
      }
      for (const row of input.analytics) {
        const data = { ...fields(row), id: ref('analytics', row.sourceId), userId, contentId: ref('content', row.contentId), recordedAt: new Date(String(row.recordedAt)), views: BigInt(String(row.views)) }
        await validateResource(repo, userId, 'analytics', data)
        await repo.table('analytics').create({ data })
      }
      for (const row of input.activities) await repo.table('activity').create({ data: { ...fields(row), id: ref('activities', row.sourceId), userId, contentId: ref('content', row.contentId), channelId: ref('channels', row.channelId), pipelineId: ref('pipelines', row.pipelineId), providerId: ref('providers', row.providerId) } })
      const prefs = { ...input.preferences }
      validateTimezone(prefs.timezone)
      for (const [field, key] of [['defaultChannelId', 'channels'], ['defaultPipelineId', 'pipelines'], ['textProviderId', 'providers'], ['voiceProviderId', 'providers'], ['imageProviderId', 'providers']]) prefs[field!] = ref(key!, prefs[field!])
      if (input.replacePreferences) {
        if (prefs.defaultPipelineId) await availablePipeline(repo, userId, prefs.defaultPipelineId)
        for (const [field, category] of [['textProviderId', 'TEXT_GENERATION'], ['voiceProviderId', 'TEXT_TO_SPEECH'], ['imageProviderId', 'IMAGE_GENERATION']]) {
          if (prefs[field!]) { const provider = await repo.require('ai-providers', userId, String(prefs[field!])); if (!provider.enabled || provider.category !== category) invalid('Imported default providers must be enabled and match their category') }
        }
        await repo.table('preferences').update({ where: { userId }, data: prefs })
      }
      const receipt = await repo.db.workspaceImport.create({ data: { userId, digest, counts: { channels: input.channels.length, providers: input.providers.length, pipelines: input.pipelines.length, content: input.content.length, schedules: input.schedules.length, jobs: input.jobs.length, analytics: input.analytics.length, activities: input.activities.length } } })
      await repo.table('activity').create({ data: { userId, category: 'SUCCESS', title: 'Browser workspace imported', detail: input.replacePreferences ? 'Atomic import complete. Preferences replaced by explicit confirmation.' : 'Atomic import complete. Existing account preferences were kept.' } })
      return { data: { id: receipt.id, digest, counts: receipt.counts } }
    })
  }
}
