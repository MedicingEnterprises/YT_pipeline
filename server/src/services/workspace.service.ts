import type { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { WorkspaceRepository, writeTransaction, type Data, type Row } from '../database/workspace.repository.js'
import { resources, type Resource } from '../schemas/resources.js'
import { availablePipeline, assertIdle, conflict, invalid, validatePipeline, validateResource, validateTimezone } from './workspace.validation.js'

export interface ListQuery extends Data { page: number; limit: number; sort: string; direction: 'asc' | 'desc'; search?: string }
const include = (resource: Resource): Data => resource === 'pipelines' ? { include: { steps: { orderBy: { order: 'asc' } }, assignments: true } } : {}
function present(row: Row): Data {
  const { assignments, ...data } = row
  if (Array.isArray(assignments)) data.assignedChannelIds = assignments.map(item => (item as Data).channelId)
  // JSON's date/Decimal toJSON methods supply ISO instants and decimal strings.
  return JSON.parse(JSON.stringify(data, (_key, value: unknown) => typeof value === 'bigint' ? value.toString() : value)) as Data
}
const timestamps = (data: Data): Data => Object.fromEntries(Object.entries(data).map(([key, value]) => [key, ['scheduledAt', 'recordedAt'].includes(key) && typeof value === 'string' ? new Date(value) : value]))
function input(data: Data): Data {
  const cleaned = { ...data }
  for (const key of ['name', 'title', 'handle', 'workspaceName']) if (typeof cleaned[key] === 'string') cleaned[key] = cleaned[key].normalize('NFKC').trim().replace(/\s+/g, ' ')
  return timestamps(cleaned)
}
export class WorkspaceService {
  constructor(private readonly database: PrismaClient) {}
  async list(resource: Resource, userId: string, query: ListQuery): Promise<Data> {
    return this.database.$transaction(async tx => {
      const repo = new WorkspaceRepository(tx)
      const definition = resources[resource]
      const where: Data = { userId }
      for (const filter of definition.filters) if (query[filter] !== undefined) where[filter] = query[filter]
      if (query.search && definition.search.length) where.OR = definition.search.map(field => ({ [field]: { contains: query.search, mode: 'insensitive' } }))
      const total = await repo.table(resource).count({ where })
      const rows = await repo.table(resource).findMany({ where, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: [{ [query.sort]: query.direction }, { id: 'asc' }], ...include(resource) })
      return { data: rows.map(present), pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } }
    }, { isolationLevel: 'RepeatableRead' })
  }
  async get(resource: Resource, userId: string, id: string): Promise<Data> {
    const repo = new WorkspaceRepository(this.database)
    const row = await repo.table(resource).findFirst({ where: { id, userId }, ...include(resource) })
    if (!row) await repo.require(resource, userId, id)
    return { data: present(row!) }
  }
  private async activity(repo: WorkspaceRepository, userId: string, resource: Resource, id: string, title: string): Promise<void> {
    const links: Partial<Record<Resource, string>> = { channels: 'channelId', 'ai-providers': 'providerId', content: 'contentId', pipelines: 'pipelineId', jobs: 'jobId' }
    await repo.table('activity').create({ data: { userId, category: 'SUCCESS', title, detail: `${resource}: ${id}`, ...(links[resource] ? { [links[resource]!]: id } : {}) } })
  }
  async save(resource: Resource, userId: string, raw: Data, id?: string): Promise<Data> {
    return writeTransaction(this.database, userId, async repo => {
      const previous = id ? await repo.require(resource, userId, id) : undefined
      const data = input(raw)
      const value: Data = { ...(resource === 'content' ? { status: 'IDEA' } : {}), ...(resource === 'pipelines' ? { enabled: true } : {}), ...previous, ...data }
      if (resource === 'schedules') return this.saveSchedule(repo, userId, data, previous)
      if (resource === 'jobs') return this.createJob(repo, userId, data)
      if (resource === 'pipeline-steps') return this.saveStep(repo, userId, data, previous)
      await validateResource(repo, userId, resource, value, previous)
      if (resource === 'analytics' && typeof data.views === 'string') data.views = BigInt(data.views)
      const assigned = data.assignedChannelIds as string[] | undefined
      const steps = data.steps as Data[] | undefined
      delete data.assignedChannelIds; delete data.steps
      if (resource === 'pipelines') {
        const allSteps = steps ?? await repo.table('pipeline-steps').findMany({ where: { userId, pipelineId: id }, orderBy: { order: 'asc' } })
        await validatePipeline(repo, userId, value, allSteps)
      }
      if (resource === 'content' && value.status === 'PUBLISHED' && previous?.status !== 'PUBLISHED') {
        data.publishedAt = new Date(); data.publishPreference = 'MANUAL'
        if (id) await this.detachSchedules(repo, userId, id)
      }
      const row = previous
        ? await repo.table(resource).update({ where: { id: previous.id, userId }, data })
        : await repo.table(resource).create({ data: { ...data, userId } })
      if (resource === 'pipelines') {
        if (steps) for (const step of steps) await repo.table('pipeline-steps').create({ data: { ...step, pipelineId: row.id, userId } })
        if (assigned) {
          await repo.table('assignments').deleteMany({ where: { userId, pipelineId: row.id } })
          for (const channelId of assigned) await repo.table('assignments').create({ data: { userId, channelId, pipelineId: row.id } })
        }
      }
      await this.activity(repo, userId, resource, row.id, `${resource} ${previous ? 'updated' : 'created'}`)
      const full = await repo.table(resource).findFirst({ where: { userId, id: row.id }, ...include(resource) })
      return { data: present(full!) }
    })
  }
  private async saveStep(repo: WorkspaceRepository, userId: string, data: Data, previous?: Row): Promise<Data> {
    const pipelineId = String(previous?.pipelineId ?? data.pipelineId)
    const pipeline = await repo.require('pipelines', userId, pipelineId)
    await assertIdle(repo, userId, { pipelineId })
    const steps = await repo.table('pipeline-steps').findMany({ where: { userId, pipelineId }, orderBy: { order: 'asc' } })
    if (!previous && data.order !== steps.length) invalid('Append a step at the next order index; use the reorder endpoint to move steps')
    const candidate = { ...previous, ...data, enabled: data.enabled ?? previous?.enabled ?? true }
    await validatePipeline(repo, userId, pipeline, previous ? steps.map(step => step.id === previous.id ? candidate : step) : [...steps, candidate])
    const row = previous ? await repo.table('pipeline-steps').update({ where: { id: previous.id, userId }, data }) : await repo.table('pipeline-steps').create({ data: { ...data, userId } })
    await this.activity(repo, userId, 'pipelines', pipelineId, `Pipeline step ${previous ? 'updated' : 'created'}`)
    return { data: present(row) }
  }
  private async saveSchedule(repo: WorkspaceRepository, userId: string, data: Data, previous?: Row): Promise<Data> {
    const value = { ...previous, ...data }
    const contentId = String(value.contentId)
    const content = await repo.require('content', userId, contentId)
    if (!previous && await repo.table('schedules').count({ where: { userId, contentId } })) conflict('Content already has a schedule; edit it instead')
    if (previous) {
      const claimed = await repo.table('jobs').count({ where: { userId, scheduleId: previous.id, OR: [{ claimed: true }, { status: 'PROCESSING' }] } })
      if (claimed) conflict('The schedule has already been claimed; cancel or resolve its job first')
    }
    if ((!previous && content.status !== 'READY') || previous && !['READY', 'SCHEDULED', 'FAILED'].includes(String(content.status))) invalid('Content must be Ready before scheduling')
    const scheduledAt = value.scheduledAt as Date
    if (!(scheduledAt instanceof Date) || !Number.isFinite(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now()) invalid('Choose a future scheduled instant with an explicit UTC offset')
    const preferences = await repo.table('preferences').findFirst({ where: { userId } })
    const timezone = value.timezone ?? preferences?.timezone ?? 'UTC'
    validateTimezone(timezone)
    const channel = await repo.require('channels', userId, String(content.channelId))
    if (channel.status !== 'CONNECTED') invalid('Mock-connect the channel before scheduling')
    await availablePipeline(repo, userId, content.pipelineId, content.channelId)
    await assertIdle(repo, userId, { contentId, ...(previous ? { NOT: { scheduleId: previous.id } } : {}) })
    if (previous) await this.cancelScheduleJobs(repo, userId, previous.id)
    const row = previous
      ? await repo.table('schedules').update({ where: { id: previous.id, userId }, data: { ...data, timezone, status: 'SCHEDULED' } })
      : await repo.table('schedules').create({ data: { ...data, userId, timezone, status: 'SCHEDULED' } })
    await repo.table('content').update({ where: { id: contentId, userId }, data: { status: 'SCHEDULED', publishPreference: 'SCHEDULE' } })
    const job = await repo.table('jobs').create({ data: { userId, contentId, pipelineId: content.pipelineId, scheduleId: row.id, mode: row.executionMode, type: row.executionMode === 'PIPELINE' ? 'PIPELINE_EXECUTION' : 'SCHEDULED_PUBLICATION', kind: 'SCHEDULING', scheduledAt, idempotencyKey: `schedule:${row.id}:${randomUUID()}` } })
    await this.event(repo, userId, job, 'Scheduled job queued')
    await this.activity(repo, userId, 'content', contentId, 'Content scheduled and mock job queued')
    return { data: present(row) }
  }
  private async createJob(repo: WorkspaceRepository, userId: string, data: Data): Promise<Data> {
    const content = await repo.require('content', userId, String(data.contentId))
    if (['SCHEDULED', 'PUBLISHED'].includes(String(content.status))) invalid('Choose unpublished, unscheduled content')
    await availablePipeline(repo, userId, content.pipelineId, content.channelId)
    await assertIdle(repo, userId, { contentId: content.id })
    const steps = await repo.table('pipeline-steps').findMany({ where: { userId, pipelineId: content.pipelineId, enabled: true }, orderBy: { order: 'asc' } })
    const kinds: Record<string, string> = { IDEA: 'IDEA_GENERATION', RESEARCH: 'IDEA_GENERATION', SCRIPT: 'SCRIPT_GENERATION', VOICE: 'VOICE_GENERATION', VISUALS: 'VISUAL_GENERATION', EDIT: 'VIDEO_EDITING', CAPTIONS: 'CAPTION_GENERATION', THUMBNAIL: 'THUMBNAIL_GENERATION', QUALITY_CHECK: 'QUALITY_CHECK', REVIEW: 'QUALITY_CHECK', UPLOAD: 'UPLOAD', SCHEDULE: 'SCHEDULING' }
    const kind = kinds[String(steps[0]!.kind)]!
    if (data.kind && data.kind !== kind) invalid('The job kind must match its first enabled pipeline step')
    const row = await repo.table('jobs').create({ data: { ...data, userId, pipelineId: content.pipelineId, pipelineStepId: steps[0]!.id, providerId: steps[0]!.providerId, kind, type: 'PIPELINE_EXECUTION' } })
    await this.event(repo, userId, row, 'Pipeline job queued')
    await this.activity(repo, userId, 'jobs', row.id, 'Pipeline job queued')
    return { data: present(row) }
  }
  private async event(repo: WorkspaceRepository, userId: string, job: Row, message: string): Promise<void> {
    await repo.table('jobEvents').create({ data: { userId, jobId: job.id, status: job.status, attempt: job.attempt, message } })
  }
  private async cancelScheduleJobs(repo: WorkspaceRepository, userId: string, scheduleId: string): Promise<void> {
    const jobs = await repo.table('jobs').findMany({ where: { userId, scheduleId, status: { in: ['QUEUED', 'PROCESSING'] } } })
    for (const job of jobs) {
      const updated = await repo.table('jobs').update({ where: { id: job.id, userId }, data: { status: 'CANCELLED', paused: false, completedAt: new Date() } })
      await this.event(repo, userId, updated, 'Schedule cancelled or replaced')
    }
  }
  private async detachSchedules(repo: WorkspaceRepository, userId: string, contentId: string): Promise<void> {
    const schedules = await repo.table('schedules').findMany({ where: { userId, contentId } })
    for (const schedule of schedules) {
      await this.cancelScheduleJobs(repo, userId, schedule.id)
      await repo.table('jobs').updateMany({ where: { userId, scheduleId: schedule.id }, data: { scheduleId: null } })
      await repo.table('schedules').delete({ where: { id: schedule.id, userId } })
    }
  }
  async remove(resource: Resource, userId: string, id: string): Promise<void> {
    await writeTransaction(this.database, userId, async repo => {
      const row = await repo.require(resource, userId, id)
      if (resource === 'channels') await assertIdle(repo, userId, { content: { channelId: id } })
      if (resource === 'pipelines') await assertIdle(repo, userId, { pipelineId: id })
      if (resource === 'ai-providers') {
        const steps = await repo.table('pipeline-steps').findMany({ where: { userId, providerId: id } })
        for (const step of steps) await assertIdle(repo, userId, { pipelineId: step.pipelineId })
      }
      if (resource === 'content') {
        await assertIdle(repo, userId, { contentId: id })
        await this.detachSchedules(repo, userId, id)
        const jobs = await repo.table('jobs').findMany({ where: { userId, contentId: id } })
        await repo.table('activity').updateMany({ where: { userId, OR: [{ contentId: id }, { jobId: { in: jobs.map(job => job.id) } }] }, data: { contentId: null, jobId: null } })
      }
      if (resource === 'schedules') {
        const running = await repo.table('jobs').count({ where: { userId, scheduleId: id, status: 'PROCESSING' } })
        if (running) conflict('Cancel the processing job before deleting this schedule')
        await this.cancelScheduleJobs(repo, userId, id)
        await repo.table('jobs').updateMany({ where: { userId, scheduleId: id }, data: { scheduleId: null } })
        const content = await repo.require('content', userId, String(row.contentId))
        if (content.status === 'SCHEDULED') await repo.table('content').update({ where: { userId, id: content.id }, data: { status: 'READY', publishPreference: 'DECIDE_LATER' } })
      }
      if (resource === 'pipeline-steps') {
        const pipelineId = String(row.pipelineId)
        await assertIdle(repo, userId, { pipelineId })
        const pipeline = await repo.require('pipelines', userId, pipelineId)
        const remaining = (await repo.table('pipeline-steps').findMany({ where: { userId, pipelineId }, orderBy: { order: 'asc' } })).filter(step => step.id !== id)
        await validatePipeline(repo, userId, pipeline, remaining.map((step, order) => ({ ...step, order })))
        await repo.table(resource).delete({ where: { userId, id } })
        for (const [order, step] of remaining.entries()) await repo.table(resource).update({ where: { userId, id: step.id }, data: { order } })
        await this.activity(repo, userId, 'pipelines', pipelineId, 'Pipeline step deleted')
        return
      }
      if (resource === 'jobs') {
        if (['QUEUED', 'PROCESSING'].includes(String(row.status))) conflict('Cancel the job before deleting its history')
        await repo.table('activity').updateMany({ where: { userId, jobId: id }, data: { jobId: null } })
      }
      // Historical links are detached, not deleted. Other FK dependencies return 409.
      const link = ({ channels: 'channelId', pipelines: 'pipelineId', 'ai-providers': 'providerId' } as Partial<Record<Resource, string>>)[resource]
      if (link) await repo.table('activity').updateMany({ where: { userId, [link]: id }, data: { [link]: null } })
      await repo.table(resource).delete({ where: { id, userId } })
      await repo.table('activity').create({ data: { userId, category: 'SUCCESS', title: `${resource} deleted`, detail: `${resource}: ${id}` } })
    })
  }
  async reorder(userId: string, pipelineId: string, ids: string[]): Promise<Data> {
    return writeTransaction(this.database, userId, async repo => {
      const pipeline = await repo.require('pipelines', userId, pipelineId)
      await assertIdle(repo, userId, { pipelineId })
      const steps = await repo.table('pipeline-steps').findMany({ where: { userId, pipelineId }, orderBy: { order: 'asc' } })
      if (ids.length !== steps.length || ids.some(id => !steps.some(step => step.id === id))) invalid('Provide every step ID from this pipeline exactly once')
      const reordered = ids.map((id, order) => ({ ...steps.find(step => step.id === id)!, order }))
      await validatePipeline(repo, userId, pipeline, reordered)
      // Temporary positive positions avoid immediate unique collisions when swapping.
      const offset = Math.max(...steps.map(step => Number(step.order))) + steps.length + 1
      for (const [index, id] of ids.entries()) await repo.table('pipeline-steps').update({ where: { userId, id }, data: { order: offset + index } })
      for (const [order, id] of ids.entries()) await repo.table('pipeline-steps').update({ where: { userId, id }, data: { order } })
      await this.activity(repo, userId, 'pipelines', pipelineId, 'Pipeline steps reordered')
      return { data: reordered.map(row => present(row as Row)) }
    })
  }
  async jobAction(userId: string, id: string, action: string): Promise<Data> {
    return writeTransaction(this.database, userId, async repo => {
      const job = await repo.require('jobs', userId, id)
      const data: Data = {}
      if (action === 'pause' || action === 'resume') {
        if (!['QUEUED', 'PROCESSING'].includes(String(job.status)) || job.paused === (action === 'pause')) conflict('This job cannot be paused/resumed in its current state')
        data.paused = action === 'pause'
      } else if (action === 'cancel') {
        if (!['QUEUED', 'PROCESSING', 'FAILED'].includes(String(job.status))) conflict('Only active or failed jobs can be cancelled')
        data.status = 'CANCELLED'; data.paused = false; data.completedAt = new Date()
        if (job.scheduleId) {
          await repo.table('schedules').update({ where: { userId, id: job.scheduleId }, data: { status: 'READY' } })
          await repo.table('content').update({ where: { userId, id: job.contentId }, data: { status: 'READY', publishPreference: 'DECIDE_LATER' } })
        }
      } else if (action === 'retry') {
        if (job.status !== 'FAILED') conflict('Only failed jobs can be retried')
        const content = await repo.require('content', userId, String(job.contentId))
        if (job.scheduledAt && !job.scheduleId) conflict('This scheduled job was superseded or its schedule was removed')
        if (content.status === 'PUBLISHED' || content.pipelineId !== job.pipelineId) conflict('The content is published or its pipeline assignment changed')
        await availablePipeline(repo, userId, job.pipelineId, content.channelId)
        await assertIdle(repo, userId, { contentId: job.contentId })
        if (job.scheduleId) {
          const channel = await repo.require('channels', userId, String(content.channelId))
          if (channel.status !== 'CONNECTED') invalid('Mock-connect the channel before retrying publication')
          await repo.table('schedules').update({ where: { userId, id: job.scheduleId }, data: { status: 'SCHEDULED' } })
          await repo.table('content').update({ where: { userId, id: content.id }, data: { status: 'SCHEDULED', publishPreference: 'SCHEDULE' } })
        } else if (content.status === 'SCHEDULED') conflict('Cancel the newer schedule before retrying this job')
        data.status = 'QUEUED'; data.attempt = Number(job.attempt) + 1; data.completedAt = null; data.startedAt = null; data.errorMessage = null; data.paused = false; data.claimed = false
      } else invalid('Unsupported job action')
      const updated = await repo.table('jobs').update({ where: { id, userId }, data })
      await this.event(repo, userId, updated, `Job ${action}`)
      await this.activity(repo, userId, 'jobs', id, `Job ${action}`)
      return { data: present(updated) }
    })
  }
  async jobHistory(userId: string, id: string, query: { page: number; limit: number }): Promise<Data> {
    return this.database.$transaction(async tx => {
      const repo = new WorkspaceRepository(tx)
      await repo.require('jobs', userId, id)
      const where = { userId, jobId: id }
      const total = await repo.table('jobEvents').count({ where })
      const events = await repo.table('jobEvents').findMany({ where, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], skip: (query.page - 1) * query.limit, take: query.limit })
      return { data: events.map(present), pagination: { ...query, total, totalPages: Math.ceil(total / query.limit) } }
    }, { isolationLevel: 'RepeatableRead' })
  }
  async preferences(userId: string, raw?: Data): Promise<Data> {
    // GET must not initialize business state: registration creates preferences.
    if (raw === undefined) return { data: present(await new WorkspaceRepository(this.database).require('preferences', userId)) }
    return writeTransaction(this.database, userId, async repo => {
      const data = input(raw ?? {})
      if (data.timezone !== undefined) validateTimezone(data.timezone)
      if (data.defaultChannelId) await repo.require('channels', userId, String(data.defaultChannelId))
      if (data.defaultPipelineId) await availablePipeline(repo, userId, data.defaultPipelineId)
      for (const [field, category] of [['textProviderId', 'TEXT_GENERATION'], ['voiceProviderId', 'TEXT_TO_SPEECH'], ['imageProviderId', 'IMAGE_GENERATION']]) {
        if (data[field!]) {
          const provider = await repo.require('ai-providers', userId, String(data[field!]))
          if (!provider.enabled || provider.category !== category) invalid('Choose an enabled provider of the appropriate category')
        }
      }
      const old = await repo.table('preferences').findFirst({ where: { userId } })
      const row = old ? raw ? await repo.table('preferences').update({ where: { userId }, data }) : old : await repo.table('preferences').create({ data: { userId, language: 'en-US', ...data } })
      if (raw) await repo.table('activity').create({ data: { userId, category: 'SUCCESS', title: 'Preferences updated' } })
      return { data: present(row) }
    })
  }
  async configurePipeline(userId: string, id: string, data: Data): Promise<Data> {
    return writeTransaction(this.database, userId, async repo => {
      const previous = await repo.require('pipelines', userId, id)
      await assertIdle(repo, userId, { pipelineId: id })
      const steps = data.steps as Data[]
      await validateResource(repo, userId, 'pipelines', { ...previous, ...data }, previous)
      await validatePipeline(repo, userId, { ...previous, ...data }, steps)
      const old = await repo.table('pipeline-steps').findMany({ where: { userId, pipelineId: id } })
      const supplied = steps.filter(step => step.id).map(step => String(step.id))
      if (new Set(supplied).size !== supplied.length || supplied.some(stepId => !old.some(step => step.id === stepId))) invalid('Step IDs must belong to this pipeline and appear once')
      for (const step of old.filter(step => !supplied.includes(step.id))) await repo.table('pipeline-steps').delete({ where: { userId, id: step.id } })
      const offset = Math.max(0, ...old.map(step => Number(step.order))) + 100
      for (const [index, step] of old.filter(step => supplied.includes(step.id)).entries()) await repo.table('pipeline-steps').update({ where: { userId, id: step.id }, data: { order: offset + index } })
      for (const step of steps) {
        if (step.id) await repo.table('pipeline-steps').update({ where: { userId, id: step.id }, data: { ...step, id: undefined } })
        else await repo.table('pipeline-steps').create({ data: { ...step, userId, pipelineId: id } })
      }
      const { steps: _steps, assignedChannelIds, ...fields } = data
      await repo.table('pipelines').update({ where: { userId, id }, data: fields })
      if (assignedChannelIds) {
        await repo.table('assignments').deleteMany({ where: { userId, pipelineId: id } })
        for (const channelId of assignedChannelIds as string[]) await repo.table('assignments').create({ data: { userId, pipelineId: id, channelId } })
      }
      await this.activity(repo, userId, 'pipelines', id, 'Pipeline configuration updated')
      return { data: present((await repo.table('pipelines').findFirst({ where: { userId, id }, ...include('pipelines') }))!) }
    })
  }
}
