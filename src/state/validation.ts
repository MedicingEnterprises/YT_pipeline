import type { AIProvider, Channel, ContentItem, ContentStatus, Pipeline, PipelineStepKind, ProviderCategory, ScheduledVideo, UserPreferences } from '../models'
import type { AppState } from './store'

export type FieldErrors = Record<string, string>
export type OperationResult = { ok: true; message: string } | { ok: false; kind: 'validation' | 'failure'; message: string; errors: FieldErrors }
export const validationError = (errors: FieldErrors): OperationResult => ({ ok: false, kind: 'validation', message: 'Please fix the highlighted fields and try again.', errors })
export const operationFailure = (): OperationResult => ({ ok: false, kind: 'failure', message: 'Your changes could not be saved. Please try again. Your previous data is safe.', errors: {} })

export const contentStatuses: ContentStatus[] = ['Idea', 'Script', 'Generating', 'Editing', 'Ready', 'Scheduled', 'Published', 'Failed']
export const providerCategories: ProviderCategory[] = ['Text generation', 'Text-to-speech', 'Image generation', 'Video generation', 'Embeddings / analysis']
export const stepKinds: PipelineStepKind[] = ['Idea', 'Script', 'Voice', 'Visuals', 'Edit', 'Captions', 'Thumbnail', 'Quality check', 'Upload', 'Schedule', 'Research', 'Review']
export const transitions: Record<ContentStatus, ContentStatus[]> = {
  Idea: ['Script'], Script: ['Idea', 'Generating', 'Failed'], Generating: ['Editing', 'Failed'],
  Editing: ['Generating', 'Ready', 'Failed'], Ready: ['Editing', 'Scheduled', 'Published', 'Failed'],
  Scheduled: ['Ready', 'Published', 'Failed'], Published: [], Failed: ['Idea', 'Script', 'Generating', 'Editing', 'Ready'],
}
export function canTransition(from: ContentStatus, to: ContentStatus): boolean {
  return contentStatuses.includes(from) && contentStatuses.includes(to) && (from === to || transitions[from].includes(to))
}
export function transitionError(from: ContentStatus, to: ContentStatus): string {
  if (from === 'Published') return 'Published content cannot return to an earlier stage. Create a new content item instead.'
  const next = transitions[from]?.join(', ')
  return next ? `Move ${from.toLowerCase()} content to ${next} before choosing ${to}.` : 'Choose a valid content status.'
}
const text = (value: unknown): value is string => typeof value === 'string'
const normalized = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
function required(errors: FieldErrors, field: string, value: unknown, label: string, max = 80) {
  if (!text(value) || !value.trim()) errors[field] = `${label} is required.`
  else if (value.trim().length > max) errors[field] = `${label} must be ${max} characters or fewer.`
}
function uniqueName<T extends { id: string }>(errors: FieldErrors, field: string, value: unknown, id: string, values: Iterable<T>, getName: (item: T) => string, label: string) {
  if (text(value) && value.trim() && Array.from(values).some(item => item.id !== id && normalized(getName(item)) === normalized(value))) errors[field] = `A ${label} with this ${field === 'handle' ? 'handle' : field === 'title' ? 'title' : 'name'} already exists. Choose another.`
}
function choice(errors: FieldErrors, field: string, value: unknown, choices: readonly string[], label: string) {
  if (!text(value) || !choices.includes(value)) errors[field] = `Choose a valid ${label}.`
}
export function isTime(value: unknown): value is string { return text(value) && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) }
// Validate every calendar component: Date alone would roll February 30 into March.
export function isDateTime(value: unknown): value is string {
  if (!text(value) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return false
  const [year, month, day, hour, minute] = value.match(/\d+/g)!.map(Number)
  if (year < 1900 || year > 9999 || month < 1 || month > 12 || hour > 23 || minute > 59) return false
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return day >= 1 && day <= days
}
export function wallTimeNow(timezone: string, instant = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant)
  const get = (type: string) => parts.find(part => part.type === type)!.value
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}
function dateError(errors: FieldErrors, value: unknown, previous: string | undefined, state: AppState, now: Date) {
  if (!isDateTime(value)) errors.scheduledAt = 'Choose a real date and a time between 00:00 and 23:59.'
  else if (value !== previous && value <= wallTimeNow(state.preferences?.timezone ?? 'Asia/Colombo', now)) errors.scheduledAt = 'Choose a date and time in the future.'
}
function links(errors: FieldErrors, channelId: unknown, pipelineId: unknown, state: AppState, requireEnabled: boolean) {
  if (!text(channelId) || !channelId) errors.channelId = 'Choose a channel for this content.'
  else if (!state.channels.has(channelId)) errors.channelId = 'This channel is no longer available. Choose another channel.'
  if (!text(pipelineId) || !pipelineId) errors.pipelineId = 'Choose a pipeline for this content.'
  else {
    const pipeline = state.pipelines.get(pipelineId)
    if (!pipeline) errors.pipelineId = 'This pipeline is no longer available. Choose another pipeline.'
    else if (requireEnabled && !pipeline.enabled) errors.pipelineId = 'This pipeline is disabled. Enable it or choose another pipeline.'
    else if (requireEnabled && Object.keys(validatePipeline(pipeline, state)).length) errors.pipelineId = 'This pipeline needs attention. Fix its steps or choose another pipeline.'
  }
}
export function validateChannel(value: Channel, state: AppState): FieldErrors {
  const errors: FieldErrors = {}
  required(errors, 'name', value.name, 'Channel name')
  required(errors, 'handle', value.handle, 'Channel handle', 50)
  uniqueName(errors, 'name', value.name, value.id, state.channels.values(), item => item.name, 'channel')
  uniqueName(errors, 'handle', value.handle, value.id, state.channels.values(), item => item.handle, 'channel')
  if (text(value.handle) && value.handle.trim() && !/^@[\p{L}\p{N}_.-]{3,30}$/u.test(value.handle.trim())) errors.handle = 'Use @ followed by 3–30 letters, numbers, dots, underscores, or hyphens.'
  choice(errors, 'status', value.status, ['connected', 'disconnected'], 'connection status')
  choice(errors, 'color', value.color, ['channel-purple', 'channel-green', 'channel-orange', 'channel-blue'], 'channel color')
  if (!text(value.category) || value.category.length > 80) errors.category = 'Keep the category to 80 characters or fewer.'
  if (value.scheduleTime && !isTime(value.scheduleTime)) errors.scheduleTime = 'Choose a valid publishing time between 00:00 and 23:59.'
  if (!text(value.scheduleDays)) errors.scheduleDays = 'Use day names such as Monday, Wednesday, Friday.'
  else if (value.scheduleDays.trim()) {
    const days = value.scheduleDays.split(/[,·]/).map(day => day.trim().toLowerCase())
    if (days.some(day => !['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].includes(day))) errors.scheduleDays = 'Separate full day names with commas, for example Monday, Wednesday, Friday.'
    else if (new Set(days).size !== days.length) errors.scheduleDays = 'List each publishing day only once.'
    if (!value.scheduleTime) errors.scheduleTime = 'Choose a publishing time for these days.'
  }
  if (value.defaultPipelineId && !state.pipelines.has(value.defaultPipelineId)) errors.defaultPipelineId = 'Choose an available default pipeline.'
  return errors
}
export function validateProvider(value: AIProvider, state: AppState): FieldErrors {
  const errors: FieldErrors = {}
  required(errors, 'name', value.name, 'Provider name')
  choice(errors, 'category', value.category, providerCategories, 'provider type')
  uniqueName(errors, 'name', value.name, value.id, Array.from(state.providers.values()).filter(provider => provider.category === value.category), item => item.name, 'provider of this type')
  if (!Array.isArray(value.models) || !value.models.length || value.models.some(model => !text(model) || !model.trim() || model.trim().length > 100)) errors.models = 'Choose at least one model. Model names must be 100 characters or fewer.'
  else if (new Set(value.models.map(normalized)).size !== value.models.length) errors.models = 'List each model only once.'
  if (typeof value.enabled !== 'boolean' || typeof value.connected !== 'boolean') errors.enabled = 'Choose whether this provider is enabled.'
  const accepted = ['id', 'name', 'category', 'connected', 'enabled', 'models', 'lastUsed', 'createdAt', 'updatedAt']
  if (Object.keys(value).some(key => !accepted.includes(key))) errors.configuration = 'Use mock configuration only. Credentials and additional connection fields are not accepted.'
  return errors
}
export function providerTypesForStep(kind: PipelineStepKind): ProviderCategory[] {
  if (kind === 'Voice') return ['Text-to-speech']
  if (kind === 'Visuals') return ['Image generation', 'Video generation']
  if (kind === 'Thumbnail') return ['Image generation']
  if (kind === 'Edit') return ['Video generation']
  if (['Research', 'Review', 'Quality check'].includes(kind)) return ['Text generation', 'Embeddings / analysis']
  if (['Idea', 'Script', 'Captions'].includes(kind)) return ['Text generation']
  return []
}
export function validatePipeline(value: Pipeline, state: AppState): FieldErrors {
  const errors: FieldErrors = {}
  required(errors, 'name', value.name, 'Pipeline name')
  uniqueName(errors, 'name', value.name, value.id, state.pipelines.values(), item => item.name, 'pipeline')
  if (!text(value.description) || value.description.length > 180) errors.description = 'Keep the description to 180 characters or fewer.'
  if (typeof value.enabled !== 'boolean') errors.enabled = 'Choose whether this pipeline is enabled.'
  if (!Array.isArray(value.assignedChannelIds) || value.assignedChannelIds.some(id => !state.channels.has(id))) errors.assignedChannelIds = 'One of the assigned channels is unavailable. Update the channel selection.'
  else if (new Set(value.assignedChannelIds).size !== value.assignedChannelIds.length) errors.assignedChannelIds = 'Assign each channel only once.'
  if (!Array.isArray(value.steps) || !value.steps.length) { errors.steps = 'Add at least one pipeline step.'; return errors }
  if (value.steps.length > 50) errors.steps = 'Use 50 steps or fewer in one pipeline.'
  if (value.enabled && !value.steps.some(step => step?.enabled)) errors.steps = 'Enable at least one step before enabling this pipeline.'
  const seen = new Set<string>()
  value.steps.forEach((step, index) => {
    const key = `steps.${index}`
    if (!step || !text(step.id) || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(step.id) || seen.has(step.id)) errors[key] = `Step ${index + 1} is duplicated or incomplete. Remove it and add it again.`
    if (!step) return
    seen.add(step.id)
    choice(errors, `${key}.kind`, step.kind, stepKinds, `type for step ${index + 1}`)
    if (step.order !== index) errors[`${key}.order`] = `The order for step ${index + 1} is invalid. Move the step and save again.`
    if (typeof step.enabled !== 'boolean') errors[`${key}.enabled`] = `Choose whether step ${index + 1} is enabled.`
    if (!step.config || !text(step.config.instructions) || step.config.instructions.length > 2000) errors[`${key}.instructions`] = `Keep instructions for step ${index + 1} to 2,000 characters or fewer.`
    const providerId = step.config?.providerId
    if (providerId === undefined || (providerId !== null && typeof providerId !== 'string')) errors[`${key}.providerId`] = `Choose a provider for step ${index + 1}, or leave it unassigned.`
    if (providerId !== null && providerId !== undefined) {
      const provider = state.providers.get(providerId)
      if (!provider) errors[`${key}.providerId`] = `The provider for step ${index + 1} is unavailable. Choose another or clear the assignment.`
      else if (!providerTypesForStep(step.kind).includes(provider.category)) errors[`${key}.providerId`] = `Choose a provider that supports ${step.kind.toLowerCase()} for step ${index + 1}.`
      else if (value.enabled && step.enabled && !provider.enabled) errors[`${key}.providerId`] = `Enable the provider for step ${index + 1}, clear its assignment, or disable this step.`
    }
  })
  const active = value.steps.filter(step => step?.enabled).map(step => step.kind)
  for (const [before, after] of [['Script', 'Voice'], ['Edit', 'Captions'], ['Upload', 'Schedule']] as const) {
    if (active.includes(before) && active.includes(after) && active.indexOf(before) > active.indexOf(after)) errors.steps = `Place ${before} before ${after} in the enabled steps.`
  }
  return errors
}
export function validateContent(value: ContentItem, state: AppState, now = new Date()): FieldErrors {
  const errors: FieldErrors = {}
  const previous = state.content.get(value.id)
  required(errors, 'title', value.title, 'Content title', 120)
  uniqueName(errors, 'title', value.title, value.id, Array.from(state.content.values()).filter(item => item.channelId === value.channelId), item => item.title, 'content item on this channel')
  choice(errors, 'status', value.status, contentStatuses, 'content status')
  choice(errors, 'format', value.format, ['Long-form video', 'YouTube Short', 'Explainer', 'Interview'], 'content format')
  choice(errors, 'publishPreference', value.publishPreference, ['Decide later', 'Publish manually when ready', 'Schedule for a date'], 'publishing preference')
  if (value.visibility !== undefined) choice(errors, 'visibility', value.visibility, ['public', 'private', 'unlisted'], 'visibility')
  if (!text(value.notes) || value.notes.length > 2000) errors.notes = 'Keep notes to 2,000 characters or fewer.'
  links(errors, value.channelId, value.pipelineId, state, !previous || previous.pipelineId !== value.pipelineId || previous.status !== value.status)
  if (previous && !canTransition(previous.status, value.status)) errors.status = transitionError(previous.status, value.status)
  if (value.status === 'Scheduled' && value.publishPreference !== 'Schedule for a date') errors.publishPreference = 'Choose Schedule for a date when content is marked Scheduled.'
  if (!previous && value.status !== 'Idea') errors.status = 'New content starts as an Idea. Save it first, then move it through the content stages.'
  if (value.scheduledAt || value.status === 'Scheduled' || value.publishPreference === 'Schedule for a date') dateError(errors, value.scheduledAt, previous?.scheduledAt, state, now)
  if (value.scheduledAt && !['Ready', 'Scheduled', 'Failed', 'Generating', 'Editing'].includes(value.status)) errors.scheduledAt = 'Finish the draft stages before scheduling this content.'
  if (value.status === 'Published' && (value.scheduledAt || value.publishPreference === 'Schedule for a date')) errors.scheduledAt = 'Published content cannot have a pending schedule. Clear the scheduled date.'
  if (value.status === 'Scheduled' || value.status === 'Published') {
    if (state.channels.get(value.channelId)?.status !== 'connected') errors.channelId = 'Mock-connect this channel before scheduling or publishing content.'
  }
  return errors
}
export function validateSchedule(value: ScheduledVideo, state: AppState, now = new Date()): FieldErrors {
  const errors: FieldErrors = {}
  choice(errors, 'status', value.status, ['Scheduled', 'Ready', 'Processing', 'Needs attention'], 'schedule status')
  const item = state.content.get(value.contentId)
  if (!item) errors.contentId = 'Choose an available content item.'
  else {
    if (!state.scheduledVideos.has(value.id) && item.status !== 'Ready') errors.contentId = 'Move this content to Ready before creating its schedule.'
    links(errors, item.channelId, item.pipelineId, state, true)
    if (item.status === 'Published') errors.contentId = 'This content is already published. Choose unpublished content.'
    const target = { Scheduled: 'Scheduled', Ready: 'Ready', Processing: 'Generating', 'Needs attention': 'Failed' }[value.status] as ContentStatus
    if (target && !canTransition(item.status, target)) errors.status = transitionError(item.status, target)
    if (value.status === 'Scheduled' && state.channels.get(item.channelId)?.status !== 'connected') errors.channelId = 'Mock-connect this channel before scheduling content.'
  }
  if (Array.from(state.scheduledVideos.values()).some(schedule => schedule.id !== value.id && schedule.contentId === value.contentId)) errors.contentId = 'This content already has a schedule. Edit its existing schedule instead.'
  dateError(errors, value.scheduledAt, state.scheduledVideos.get(value.id)?.scheduledAt, state, now)
  return errors
}
export function validatePreferences(value: UserPreferences, state: AppState): FieldErrors {
  const errors: FieldErrors = {}
  required(errors, 'workspaceName', value.workspaceName, 'Workspace name')
  try { new Intl.DateTimeFormat('en', { timeZone: value.timezone }).format(new Date(0)); if (!value.timezone) throw new Error() } catch { errors.timezone = 'Choose a valid timezone.' }
  choice(errors, 'language', value.language, ['en-US', 'en-GB', 'es', 'fr'], 'language')
  choice(errors, 'appearance', value.appearance, ['light', 'dark', 'system'], 'color theme')
  choice(errors, 'weeklyDigest', value.weeklyDigest, ['never', 'monday', 'friday'], 'weekly digest frequency')
  choice(errors, 'defaultVisibility', value.defaultVisibility, ['public', 'private', 'unlisted'], 'default visibility')
  if (!isTime(value.defaultPublishTime)) errors.defaultPublishTime = 'Choose a publishing time between 00:00 and 23:59.'
  for (const key of ['compactDensity', 'reducedMotion', 'notifyPipeline', 'notifyPublishing', 'notifyWarnings'] as const) if (typeof value[key] !== 'boolean') errors[key] = 'Choose whether this preference is enabled.'
  if (value.defaultChannelId && !state.channels.has(value.defaultChannelId)) errors.defaultChannelId = 'Choose an available default channel or clear the selection.'
  if (value.defaultPipelineId && !state.pipelines.get(value.defaultPipelineId)?.enabled) errors.defaultPipelineId = 'Choose an enabled default pipeline or clear the selection.'
  for (const [key, category] of [['textProviderId', 'Text generation'], ['voiceProviderId', 'Text-to-speech'], ['imageProviderId', 'Image generation']] as const) {
    const provider = value[key] ? state.providers.get(value[key]!) : undefined
    if (value[key] && (!provider?.enabled || provider.category !== category)) errors[key] = `Choose an enabled ${category.toLowerCase()} provider or clear the selection.`
  }
  return errors
}

export function isPipelineAvailable(state: AppState, id: string): boolean {
  const pipeline = state.pipelines.get(id)
  return Boolean(pipeline?.enabled && !Object.keys(validatePipeline(pipeline, state)).length)
}
