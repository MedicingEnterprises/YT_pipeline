import { ContentStatus, ContentFormat, Visibility, PublishPreference, ChannelStatus, ProviderCategory, StepKind, JobKind, JobType, JobStatus, ScheduleStatus, ActivityCategory, Appearance, WeeklyDigest } from '@prisma/client'

import { adapterIds } from '../services/providers/adapters.js'

type Schema = Record<string, unknown>
export const uuid: Schema = { type: 'string', format: 'uuid' }
const nullableId: Schema = { type: ['string', 'null'], format: 'uuid' }
const text = (maxLength = 80): Schema => ({ type: 'string', minLength: 1, maxLength, pattern: '\\S' })
const optionalText = (maxLength: number): Schema => ({ type: 'string', maxLength })
const enumeration = (values: Record<string, string>): Schema => ({ type: 'string', enum: Object.values(values) })
const bool: Schema = { type: 'boolean' }
const integer = (minimum: number, maximum: number): Schema => ({ type: 'integer', minimum, maximum })
const instant: Schema = { type: 'string', format: 'date-time', pattern: '(Z|[+-][0-9]{2}:[0-9]{2})$' }
const time: Schema = { type: 'string', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' }
export const objectSchema = (properties: Record<string, Schema>, required: string[] = []): Schema => ({ type: 'object', additionalProperties: false, properties, required })
const step = {
  kind: enumeration(StepKind), enabled: bool, order: integer(0, 49), providerId: nullableId,
  instructions: optionalText(2000), durationMs: integer(0, 3600000),
}
export const resources = {
  channels: { delegate: 'channel', required: ['name', 'handle'], search: ['name', 'handle'], filters: ['status'], sort: ['name', 'createdAt', 'updatedAt'], properties: {
    name: text(), handle: text(50), category: optionalText(80), color: { type: 'string', enum: ['channel-purple', 'channel-green', 'channel-orange', 'channel-blue'] }, status: enumeration(ChannelStatus), scheduleDays: optionalText(100), scheduleTime: time, defaultPipelineId: nullableId,
  } },
  'ai-providers': { delegate: 'aIProvider', required: ['name', 'category', 'models'], search: ['name'], filters: ['category', 'enabled'], sort: ['name', 'createdAt', 'updatedAt'], properties: {
    name: text(), category: enumeration(ProviderCategory), connected: bool, enabled: bool,
    adapterId: { type: 'string', enum: [...adapterIds] },
    apiKey: { type: ['string', 'null'], minLength: 1, maxLength: 8192, pattern: '\\S', writeOnly: true },
    models: { type: 'array', minItems: 1, maxItems: 100, uniqueItems: true, items: text(100) },
  } },
  content: { delegate: 'contentItem', required: ['title', 'channelId', 'pipelineId'], search: ['title', 'notes'], filters: ['status', 'channelId', 'pipelineId', 'format'], sort: ['title', 'createdAt', 'updatedAt', 'publishedAt'], properties: {
    title: text(120), channelId: uuid, pipelineId: uuid, status: enumeration(ContentStatus), format: enumeration(ContentFormat), visibility: enumeration(Visibility), publishPreference: enumeration(PublishPreference), notes: optionalText(2000), thumbnail: optionalText(2048),
  } },
  pipelines: { delegate: 'pipeline', required: ['name', 'steps'], search: ['name', 'description'], filters: ['enabled'], sort: ['name', 'createdAt', 'updatedAt'], properties: {
    name: text(), description: optionalText(180), enabled: bool,
    assignedChannelIds: { type: 'array', maxItems: 100, uniqueItems: true, items: uuid },
    steps: { type: 'array', minItems: 1, maxItems: 50, items: objectSchema(step, ['kind', 'order']) },
  } },
  'pipeline-steps': { delegate: 'pipelineStep', required: ['pipelineId', 'kind', 'order'], search: ['instructions'], filters: ['pipelineId', 'kind', 'enabled'], sort: ['order', 'createdAt', 'updatedAt'], properties: { pipelineId: uuid, ...step } },
  schedules: { delegate: 'schedule', required: ['contentId', 'scheduledAt'], search: [], filters: ['contentId', 'status'], sort: ['scheduledAt', 'createdAt', 'updatedAt'], properties: {
    contentId: uuid, scheduledAt: instant, timezone: text(100), executionMode: { type: 'string', enum: ['PIPELINE', 'PUBLICATION'] },
  } },
  jobs: { delegate: 'job', required: ['contentId'], search: ['errorMessage'], filters: ['contentId', 'pipelineId', 'status', 'type'], sort: ['createdAt', 'updatedAt', 'scheduledAt'], properties: {
    contentId: uuid, kind: enumeration(JobKind), type: { ...enumeration(JobType), enum: ['PIPELINE_EXECUTION'] }, idempotencyKey: text(300),
  } },
  activity: { delegate: 'activity', required: [], search: ['title', 'detail'], filters: ['contentId', 'channelId', 'pipelineId', 'providerId', 'jobId', 'category'], sort: ['createdAt'], properties: {} },
  analytics: { delegate: 'analyticsRecord', required: ['contentId'], search: [], filters: ['contentId'], sort: ['recordedAt', 'createdAt', 'views'], properties: {
    contentId: uuid, recordedAt: instant, views: { type: 'string', pattern: '^(0|[1-9][0-9]{0,18})$' },
    watchTimeHours: { type: 'string', pattern: '^[0-9]{1,12}(\\.[0-9]{1,4})?$' },
    averageDurationSeconds: { type: 'string', pattern: '^[0-9]{1,9}(\\.[0-9]{1,3})?$' },
    engagementRate: { type: 'number', minimum: 0, maximum: 100 }, subscribersGained: integer(-2147483648, 2147483647),
  } },
} satisfies Record<string, { delegate: string; required: string[]; search: string[]; filters: string[]; sort: string[]; properties: Record<string, Schema> }>
export type Resource = keyof typeof resources
export const preferencesSchema = objectSchema({
  workspaceName: text(), timezone: text(100), language: { type: 'string', enum: ['en-US', 'en-GB', 'es', 'fr'] }, appearance: enumeration(Appearance), compactDensity: bool, reducedMotion: bool,
  notifyPipeline: bool, notifyPublishing: bool, notifyWarnings: bool, weeklyDigest: enumeration(WeeklyDigest), defaultChannelId: nullableId, defaultPipelineId: nullableId,
  textProviderId: nullableId, voiceProviderId: nullableId, imageProviderId: nullableId, defaultVisibility: enumeration(Visibility), defaultPublishTime: time,
})
export function bodySchema(resource: Resource, patch: boolean): Schema {
  const definition = resources[resource]
  const properties: Record<string, Schema> = { ...definition.properties }
  if (patch && resource === 'pipelines') delete properties.steps
  if (patch && resource === 'pipeline-steps') { delete properties.pipelineId; delete properties.order }
  if (patch && ['schedules', 'analytics'].includes(resource)) delete properties.contentId
  return { ...objectSchema(properties, patch ? [] : definition.required), ...(patch ? { minProperties: 1 } : {}) }
}
export function listSchema(resource: Resource): Schema {
  const definition = resources[resource]
  const properties: Record<string, Schema> = {
    page: { ...integer(1, 100000), default: 1 }, limit: { ...integer(1, 100), default: 25 },
    sort: { type: 'string', enum: definition.sort, default: definition.sort.includes('createdAt') ? 'createdAt' : definition.sort[0] }, direction: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
  }
  if (definition.search.length) properties.search = optionalText(200)
  for (const filter of definition.filters) {
    const source = (definition.properties as Record<string, Schema>)[filter]
    properties[filter] = filter === 'type' && resource === 'jobs' ? enumeration(JobType) : source ?? (filter.endsWith('Id') ? uuid : filter === 'category' ? enumeration(ActivityCategory) : filter === 'status' ? enumeration(resource === 'schedules' ? ScheduleStatus : JobStatus) : { type: 'string', maxLength: 100 })
  }
  return objectSchema(properties)
}
export const idParams = objectSchema({ id: uuid }, ['id'])
export const jobActionSchema = objectSchema({ action: { type: 'string', enum: ['pause', 'resume', 'cancel', 'retry'] } }, ['action'])
export const reorderSchema = objectSchema({ stepIds: { type: 'array', minItems: 1, maxItems: 50, uniqueItems: true, items: uuid } }, ['stepIds'])
export const pipelineConfigurationSchema = (() => {
  const schema = structuredClone(bodySchema('pipelines', false))
  const properties = schema.properties as Record<string, Schema>
  const steps = properties.steps!
  steps.items = { ...(steps.items as Schema), properties: { ...((steps.items as Schema).properties as Record<string, Schema>), id: uuid } }
  return schema
})()
