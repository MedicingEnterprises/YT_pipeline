import type { ContentItem, ScheduledVideo, ContentStatus, ScheduleStatus } from '../models'
import type { AppState } from './store'
import { suggestedScheduleMode } from './selectors.ts'

const now = () => new Date().toISOString()
const contentStatus: Record<ScheduleStatus, ContentStatus> = { Scheduled: 'Scheduled', Ready: 'Ready', Processing: 'Generating', 'Needs attention': 'Failed' }
const scheduleStatus = (status: ContentStatus): ScheduleStatus => status === 'Failed' ? 'Needs attention' : ['Generating', 'Editing', 'Script'].includes(status) ? 'Processing' : status === 'Ready' ? 'Ready' : 'Scheduled'

function recordActivity(state: AppState, item: ContentItem, title: string): AppState {
  const preferences = state.preferences
  const enabled = item.status === 'Failed' ? preferences?.notifyWarnings : ['Scheduled', 'Published'].includes(item.status) ? preferences?.notifyPublishing : preferences?.notifyPipeline
  if (enabled === false) return state
  return { ...state, activities: [{ id: crypto.randomUUID(), category: 'Success' as const, title, detail: item.title, time: 'Just now', icon: 'Activity', tone: 'activity-green' as const, relatedContentId: item.id, createdAt: now() }, ...state.activities].slice(0, 100) }
}

export function saveContent(state: AppState, item: ContentItem): AppState {
  const content = new Map(state.content)
  const scheduledVideos = new Map(state.scheduledVideos)
  const analytics = new Map(state.analytics)
  const updated = { ...item, updatedAt: now() }
  const related = Array.from(scheduledVideos.values()).find(schedule => schedule.contentId === item.id)
  if (item.scheduledAt && item.status !== 'Published') {
    const schedule: ScheduledVideo = { id: related?.id ?? `schedule-${item.id}`, contentId: item.id, title: item.title, thumbnail: item.thumbnail, channelId: item.channelId, pipelineId: item.pipelineId, scheduledAt: item.scheduledAt, status: scheduleStatus(item.status), createdAt: related?.createdAt ?? now(), updatedAt: now() }
    scheduledVideos.set(schedule.id, { ...schedule, executionMode: related?.executionMode ?? suggestedScheduleMode(state, item.id) })
  } else {
    for (const [id, schedule] of scheduledVideos) if (schedule.contentId === item.id) scheduledVideos.delete(id)
    updated.scheduledAt = ''
    if (updated.publishPreference === 'Schedule for a date') updated.publishPreference = 'Decide later'
  }
  content.set(item.id, updated)
  for (const [id, video] of analytics) if (video.contentId === item.id) analytics.set(id, { ...video, title: item.title, channelId: item.channelId, pipelineId: item.pipelineId, thumbnail: item.thumbnail })
  return recordActivity({ ...state, content, scheduledVideos, analytics }, updated, state.content.has(item.id) ? 'Content updated' : 'Content created')
}

export function removeSchedule(state: AppState, id: string): AppState {
  const scheduledVideos = new Map(state.scheduledVideos)
  const schedule = scheduledVideos.get(id)
  scheduledVideos.delete(id)
  const content = new Map(state.content)
  const item = schedule && content.get(schedule.contentId)
  if (item) content.set(item.id, { ...item, scheduledAt: '', publishPreference: 'Decide later', status: item.status === 'Scheduled' ? 'Ready' : item.status, updatedAt: now() })
  return { ...state, scheduledVideos, content }
}

export function saveSchedule(state: AppState, schedule: ScheduledVideo): AppState {
  if (!state.content.has(schedule.contentId) || !schedule.scheduledAt || !Number.isFinite(new Date(schedule.scheduledAt).getTime())) return state
  let next = state
  const previous = state.scheduledVideos.get(schedule.id)
  if (previous && previous.contentId !== schedule.contentId) next = removeSchedule(next, previous.id)
  const content = new Map(next.content)
  const scheduledVideos = new Map(next.scheduledVideos)
  const item = content.get(schedule.contentId)!
  for (const [id, other] of scheduledVideos) if (other.contentId === item.id && id !== schedule.id) scheduledVideos.delete(id)
  scheduledVideos.set(schedule.id, { ...schedule, executionMode: schedule.executionMode ?? suggestedScheduleMode(state, item.id), title: item.title, channelId: item.channelId, pipelineId: item.pipelineId, thumbnail: item.thumbnail, updatedAt: now() })
  content.set(item.id, { ...item, scheduledAt: schedule.scheduledAt, status: contentStatus[schedule.status], publishPreference: 'Schedule for a date', updatedAt: now() })
  return recordActivity({ ...next, content, scheduledVideos }, content.get(item.id)!, 'Mock schedule updated')
}

export function removeContent(state: AppState, id: string): AppState {
  const content = new Map(state.content)
  content.delete(id)
  return { ...state, content, scheduledVideos: new Map(Array.from(state.scheduledVideos).filter(([, item]) => item.contentId !== id)), jobs: new Map(Array.from(state.jobs).filter(([, item]) => item.contentId !== id)), analytics: new Map(Array.from(state.analytics).filter(([, item]) => item.contentId !== id)), activities: state.activities.filter(item => item.relatedContentId !== id), selectedContentId: state.selectedContentId === id ? null : state.selectedContentId }
}

export function removePipeline(state: AppState, id: string): AppState {
  const pipelines = new Map(state.pipelines)
  pipelines.delete(id)
  return { ...state, pipelines,
    channels: new Map(Array.from(state.channels, ([key, item]) => [key, item.defaultPipelineId === id ? { ...item, defaultPipelineId: null } : item])),
    content: new Map(Array.from(state.content, ([key, item]) => [key, item.pipelineId === id ? { ...item, pipelineId: '' } : item])),
    scheduledVideos: new Map(Array.from(state.scheduledVideos, ([key, item]) => [key, item.pipelineId === id ? { ...item, pipelineId: '' } : item])),
    analytics: new Map(Array.from(state.analytics, ([key, item]) => [key, item.pipelineId === id ? { ...item, pipelineId: '' } : item])),
    preferences: state.preferences && { ...state.preferences, defaultPipelineId: state.preferences.defaultPipelineId === id ? null : state.preferences.defaultPipelineId },
    selectedPipelineId: state.selectedPipelineId === id ? null : state.selectedPipelineId,
  }
}

export function removeProvider(state: AppState, id: string): AppState {
  const providers = new Map(state.providers)
  providers.delete(id)
  const preferences = state.preferences && { ...state.preferences }
  if (preferences) for (const key of ['textProviderId', 'voiceProviderId', 'imageProviderId'] as const) if (preferences[key] === id) preferences[key] = null
  return { ...state, providers, preferences,
    pipelines: new Map(Array.from(state.pipelines, ([key, pipeline]) => [key, { ...pipeline, steps: pipeline.steps.map(step => step.config.providerId === id ? { ...step, config: { ...step.config, providerId: null } } : step) }])),
    jobs: new Map(Array.from(state.jobs, ([key, job]) => [key, job.providerId === id ? { ...job, providerId: null } : job])),
  }
}

export function removeChannel(state: AppState, id: string): AppState {
  // A channel with content cannot be deleted until that content is reassigned or removed.
  if (Array.from(state.content.values()).some(item => item.channelId === id)) return state
  const channels = new Map(state.channels)
  channels.delete(id)
  return { ...state, channels,
    pipelines: new Map(Array.from(state.pipelines, ([key, pipeline]) => [key, { ...pipeline, assignedChannelIds: pipeline.assignedChannelIds.filter(channelId => channelId !== id) }])),
    scheduledVideos: new Map(Array.from(state.scheduledVideos).filter(([, item]) => item.channelId !== id)),
    analytics: new Map(Array.from(state.analytics).filter(([, item]) => item.channelId !== id)),
    preferences: state.preferences && { ...state.preferences, defaultChannelId: state.preferences.defaultChannelId === id ? null : state.preferences.defaultChannelId },
    selectedChannelId: state.selectedChannelId === id ? null : state.selectedChannelId,
  }
}
