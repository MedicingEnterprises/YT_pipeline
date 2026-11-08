import { ContentStatus, JobStatus, JobKind, JobType, ScheduleStatus, ActivityCategory } from '@prisma/client'
import { bodySchema, objectSchema, preferencesSchema } from './resources.js'
type Schema = Record<string, unknown>
const sourceId = { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$' }
const nullable = { ...sourceId, type: ['string', 'null'] }
function entity(resource: Parameters<typeof bodySchema>[0], refs: string[] = []) {
  const schema = structuredClone(bodySchema(resource, false))
  const properties = schema.properties as Record<string, Schema>
  properties.sourceId = sourceId
  properties.createdAt = { type: 'string', format: 'date-time' }
  properties.updatedAt = { type: 'string', format: 'date-time' }
  for (const field of refs) properties[field] = nullable
  schema.required = ['sourceId', ...(schema.required as string[])]
  return schema
}
const pipeline = entity('pipelines')
const pipelineProps = pipeline.properties as Record<string, Schema>
pipelineProps.assignedChannelIds = { type: 'array', uniqueItems: true, maxItems: 100, items: sourceId }
const steps = pipelineProps.steps!.items as Schema
;(steps.properties as Record<string, Schema>).providerId = nullable
const channel = entity('channels', ['defaultPipelineId'])
const content = entity('content', ['pipelineId', 'channelId'])
const schedule = entity('schedules', ['contentId'])
;(schedule.properties as Record<string, Schema>).status = { type: 'string', enum: Object.values(ScheduleStatus) }
const analytics = entity('analytics', ['contentId'])
const preferences = structuredClone(preferencesSchema)
for (const field of ['defaultChannelId', 'defaultPipelineId', 'textProviderId', 'voiceProviderId', 'imageProviderId']) (preferences.properties as Record<string, Schema>)[field] = nullable
const array = (items: Schema) => ({ type: 'array', maxItems: 1000, items })
const jobHistory = objectSchema({ status: { type: 'string', enum: Object.values(JobStatus) }, at: { type: 'string', format: 'date-time' }, attempt: { type: 'integer', minimum: 1, maximum: 2147483647 }, message: { type: 'string', maxLength: 4000 } }, ['status', 'at', 'attempt', 'message'])
export const importSchema = objectSchema({
  version: { const: 1, type: 'integer' }, replacePreferences: { type: 'boolean', default: false },
  channels: array(channel), providers: array(entity('ai-providers')), pipelines: array(pipeline), content: array(content), schedules: array(schedule), analytics: array(analytics), preferences,
  jobs: array(objectSchema({ sourceId, contentId: sourceId, pipelineId: nullable, providerId: nullable, createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' }, startedAt: { type: ['string', 'null'], format: 'date-time' }, completedAt: { type: ['string', 'null'], format: 'date-time' }, attempt: { type: 'integer', minimum: 1, maximum: 2147483647 }, history: array(jobHistory), status: { type: 'string', enum: Object.values(JobStatus) }, kind: { type: 'string', enum: Object.values(JobKind) }, type: { type: 'string', enum: Object.values(JobType) }, progress: { type: 'integer', minimum: 0, maximum: 100 }, errorMessage: { type: ['string', 'null'], maxLength: 2000 } }, ['sourceId', 'contentId', 'status', 'kind'])),
  activities: array(objectSchema({ sourceId, contentId: nullable, channelId: nullable, pipelineId: nullable, providerId: nullable, createdAt: { type: 'string', format: 'date-time' }, title: { type: 'string', maxLength: 1000 }, detail: { type: 'string', maxLength: 4000 }, category: { type: 'string', enum: Object.values(ActivityCategory) }, icon: { type: 'string', maxLength: 80 }, tone: { type: 'string', maxLength: 80 } }, ['sourceId', 'title', 'category'])),
}, ['version', 'channels', 'providers', 'pipelines', 'content', 'schedules', 'jobs', 'analytics', 'activities', 'preferences'])
// Historical status is allowed on import only; normal create still requires IDEA.
;(content.properties as Record<string, Schema>).status = { type: 'string', enum: Object.values(ContentStatus) }
