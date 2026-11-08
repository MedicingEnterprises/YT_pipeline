import { contentTransitions, supportedProviderCategories, validChannelHandle, type WorkflowStatus } from '../domain/workflow-rules.js'
import { HttpError } from '../middleware/errors.js'
import { WorkspaceRepository, type Data, type Row } from '../database/workspace.repository.js'
import type { Resource } from '../schemas/resources.js'

export const invalid = (message: string): never => { throw new HttpError(422, 'VALIDATION_ERROR', message) }
export const conflict = (message: string): never => { throw new HttpError(409, 'WORKFLOW_CONFLICT', message) }
export const label = (value: unknown): string => String(value).toLowerCase().replaceAll('_', ' ').replace(/^./, c => c.toUpperCase())
const providerLabels: Record<string, string> = { TEXT_GENERATION: 'Text generation', TEXT_TO_SPEECH: 'Text-to-speech', IMAGE_GENERATION: 'Image generation', VIDEO_GENERATION: 'Video generation', EMBEDDINGS_ANALYSIS: 'Embeddings / analysis' }
export function validateTimezone(value: unknown): void {
  try { if (typeof value !== 'string' || !value) throw Error(); new Intl.DateTimeFormat('en', { timeZone: value }).format(0) } catch { invalid('Choose a valid IANA timezone') }
}
export async function assertIdle(repo: WorkspaceRepository, userId: string, where: Data): Promise<void> {
  if (await repo.table('jobs').count({ where: { userId, status: { in: ['QUEUED', 'PROCESSING'] }, ...where } })) conflict('Cancel active jobs before changing their workflow dependencies')
}
export async function validateStep(repo: WorkspaceRepository, userId: string, step: Data, pipelineEnabled: boolean): Promise<void> {
  if (step.providerId) {
    const provider = await repo.require('ai-providers', userId, String(step.providerId))
    if (!supportedProviderCategories(label(step.kind)).includes(providerLabels[String(provider.category)]!)) invalid('Provider category does not support this step')
    if (pipelineEnabled && step.enabled !== false && !provider.enabled) invalid('Enable the provider or disable this step')
  }
}
export async function validatePipeline(repo: WorkspaceRepository, userId: string, pipeline: Data, steps: Data[]): Promise<void> {
  if (!steps.length || steps.length > 50) invalid('A pipeline needs between 1 and 50 steps')
  if (pipeline.enabled !== false && !steps.some(step => step.enabled !== false)) invalid('An enabled pipeline needs an enabled step')
  for (const [index, step] of steps.entries()) {
    if (step.order !== index) invalid('Pipeline step order must be contiguous starting at zero')
    await validateStep(repo, userId, step, pipeline.enabled !== false)
  }
  const active = steps.filter(step => step.enabled !== false).map(step => step.kind)
  for (const [before, after] of [['SCRIPT', 'VOICE'], ['EDIT', 'CAPTIONS'], ['UPLOAD', 'SCHEDULE']]) {
    if (active.includes(before) && active.includes(after) && active.indexOf(before) > active.indexOf(after)) invalid(`Place ${before} before ${after}`)
  }
}
export async function availablePipeline(repo: WorkspaceRepository, userId: string, pipelineId: unknown, channelId?: unknown): Promise<Row> {
  if (!pipelineId) invalid('Select a pipeline')
  const pipeline = await repo.require('pipelines', userId, String(pipelineId))
  if (!pipeline.enabled) invalid('Select an enabled pipeline')
  const steps = await repo.table('pipeline-steps').findMany({ where: { userId, pipelineId }, orderBy: { order: 'asc' } })
  await validatePipeline(repo, userId, pipeline, steps)
  const assignments = await repo.table('assignments').findMany({ where: { userId, pipelineId } })
  if (channelId && assignments.length && !assignments.some(item => item.channelId === channelId)) invalid('This pipeline is not assigned to the content channel')
  return pipeline
}
export async function validateResource(repo: WorkspaceRepository, userId: string, resource: Resource, value: Data, previous?: Row, mode: 'live' | 'import' = 'live'): Promise<void> {
  const nameField = resource === 'content' ? 'title' : ['channels', 'ai-providers', 'pipelines'].includes(resource) ? 'name' : undefined
  if (nameField) {
    const same = await repo.table(resource).findMany({ where: { userId, ...(resource === 'content' ? { channelId: value.channelId } : {}), ...(resource === 'ai-providers' ? { category: value.category } : {}) } })
    const normalized = (v: unknown) => String(v).normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
    if (same.some(row => row.id !== previous?.id && normalized(row[nameField]) === normalized(value[nameField]))) invalid(`This ${nameField} is already in use`)
  }
  if (resource === 'channels') {
    if (!validChannelHandle(String(value.handle))) invalid('Use @ followed by 3–30 letters, numbers, dots, underscores or hyphens')
    if (value.scheduleDays) {
      const days = String(value.scheduleDays).split(/[,·]/).map(day => day.trim().toLowerCase())
      if (new Set(days).size !== days.length || days.some(day => !['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].includes(day))) invalid('Use unique full day names separated by commas')
    }
    if (value.defaultPipelineId) await repo.require('pipelines', userId, String(value.defaultPipelineId))
    if (previous && value.status !== previous.status) await assertIdle(repo, userId, { content: { channelId: previous.id } })
  }
  if (resource === 'ai-providers') {
    const models = value.models as string[]
    if (new Set(models.map(model => model.trim().toLowerCase())).size !== models.length) invalid('List each model only once')
    if (previous && ['category', 'enabled', 'models'].some(key => JSON.stringify(value[key]) !== JSON.stringify(previous[key]))) {
      const steps = await repo.table('pipeline-steps').findMany({ where: { userId, providerId: previous.id } })
      for (const step of steps) {
        await assertIdle(repo, userId, { pipelineId: step.pipelineId })
        if (!supportedProviderCategories(label(step.kind)).includes(providerLabels[String(value.category)]!)) invalid('Provider category is incompatible with an assigned step')
      }
    }
  }
  if (resource === 'content') {
    const channel = await repo.require('channels', userId, String(value.channelId))
    if (mode === 'import') { if (value.pipelineId) await repo.require('pipelines', userId, String(value.pipelineId)); return }
    if (!previous || ['pipelineId', 'channelId', 'status'].some(key => previous[key] !== value[key])) {
      await availablePipeline(repo, userId, value.pipelineId, value.channelId)
      if (previous) await assertIdle(repo, userId, { contentId: previous.id })
    }
    if (!previous && value.status !== 'IDEA') invalid('New content must start as IDEA')
    if (previous && value.status !== previous.status) {
      const from = label(previous.status) as WorkflowStatus
      if (!contentTransitions[from]?.includes(label(value.status) as WorkflowStatus)) conflict(`Cannot transition ${previous.status} to ${value.status}`)
      if (value.status === 'SCHEDULED') invalid('Use the schedules endpoint to schedule content')
      if (previous.status === 'SCHEDULED' && value.status !== 'PUBLISHED') invalid('Cancel the schedule before changing this content stage')
    }
    if (value.status === 'PUBLISHED' && channel.status !== 'CONNECTED') invalid('Mock-connect the channel before publication')
    if (value.publishPreference === 'SCHEDULE' && value.status !== 'SCHEDULED') invalid('Use the schedules endpoint for scheduled publishing')
  }
  if (resource === 'pipelines') {
    if (previous) await assertIdle(repo, userId, { pipelineId: previous.id })
    for (const channelId of (value.assignedChannelIds ?? []) as string[]) await repo.require('channels', userId, channelId)
  }
  if (resource === 'analytics') {
    const content = await repo.require('content', userId, String(value.contentId))
    if (content.status !== 'PUBLISHED') invalid('Analytics records require published content')
    if (value.views !== undefined && BigInt(String(value.views)) > 9223372036854775807n) invalid('Views exceed the supported integer range')
  }
}
