/**
 * Adapter functions to bridge UI components with the centralized state.
 * These functions convert between the old UI format and the new domain models.
 */

import type {
  ContentStatus,
  ScheduleStatus,
  ProviderCategory,
} from '../models'
import { useStore, useChannels, useProviders, useContent, usePipelines, useScheduledVideos } from './store'

// ============================================================================
// CHANNEL ADAPTERS
// ============================================================================

export function useChannelRows() {
  const channels = useChannels()
  const { state } = useStore()
  return channels.map((channel) => ({
    id: channel.id,
    name: channel.name,
    handle: channel.handle,
    category: channel.category,
    subscribers: channel.subscribers,
    videos: channel.videos,
    initials: channel.initials,
    color: channel.color,
    connected: channel.status === 'connected',
    recentActivity: channel.recentActivity,
    activityTime: channel.activityTime,
    scheduleDays: channel.scheduleDays,
    scheduleTime: channel.scheduleTime,
    scheduledCount: Array.from(state.scheduledVideos.values()).filter(item => item.channelId === channel.id).length,
    publishedCount: Array.from(state.content.values()).filter(item => item.channelId === channel.id && item.status === 'Published').length,
    pipeline: state.pipelines.get(channel.defaultPipelineId ?? '')?.name ?? 'Not assigned',
    recentUploads: Array.from(state.content.values()).filter(item => item.channelId === channel.id).map(item => ({ id: item.id, title: item.title, status: item.status, date: item.scheduledAt || item.createdAt, tone: item.status === 'Published' ? 'green' as const : 'blue' as const })),
  }))
}

export function useChannelByName(name: string) {
  const channels = useChannels()
  return channels.find((channel) => channel.name === name)
}

// ============================================================================
// PROVIDER ADAPTERS
// ============================================================================

export function useProviderRows() {
  const providers = useProviders()
  return providers
}

export function useProviderCategories(): ProviderCategory[] {
  return [
    'Text generation',
    'Text-to-speech',
    'Image generation',
    'Video generation',
    'Embeddings / analysis',
  ]
}

export function useModelsByCategory(): Record<ProviderCategory, string[]> {
  return {
    'Text generation': ['GPT-4o', 'Claude 3.7 Sonnet', 'Gemini 2.5 Pro'],
    'Text-to-speech': ['Eleven Multilingual v2', 'PlayHT 2.0', 'OpenAI TTS'],
    'Image generation': ['Imagen 3', 'Stable Diffusion XL', 'DALL·E 3'],
    'Video generation': ['Runway Gen-3', 'Veo 2', 'Kling 2.1'],
    'Embeddings / analysis': ['text-embedding-3-large', 'Voyage 3', 'Gemini Embedding'],
  }
}

// ============================================================================
// CONTENT ADAPTERS
// ============================================================================

export function useContentRows() {
  const content = useContent()
  const { state } = useStore()
  const channels = useChannels()
  
  return content.map((item) => ({
    id: item.id,
    title: item.title,
    channel: channels.find((ch) => ch.id === item.channelId)?.name || 'Unassigned',
    pipeline: state.pipelines.get(item.pipelineId)?.name ?? 'Unassigned',
    status: item.status,
    createdAt: item.createdAt,
    scheduledAt: item.scheduledAt,
    format: item.format,
    publishPreference: item.publishPreference,
    notes: item.notes,
    image: item.thumbnail,
  }))
}

export function useContentStatuses(): ContentStatus[] {
  return ['Idea', 'Script', 'Generating', 'Editing', 'Ready', 'Scheduled', 'Published', 'Failed']
}

export function useContentStatusTone(): Record<ContentStatus, 'neutral' | 'blue' | 'violet' | 'amber' | 'green' | 'red'> {
  return {
    Idea: 'neutral',
    Script: 'blue',
    Generating: 'violet',
    Editing: 'amber',
    Ready: 'green',
    Scheduled: 'blue',
    Published: 'green',
    Failed: 'red',
  }
}

// ============================================================================
// PIPELINE ADAPTERS
// ============================================================================

export function usePipelineRows() {
  const pipelines = usePipelines()
  
  return pipelines.map((pipeline) => ({
    id: pipeline.id,
    name: pipeline.name,
    description: pipeline.description,
    assignedChannels: pipeline.assignedChannelIds,
    enabled: pipeline.enabled,
    lastUsed: pipeline.lastUsed,
    steps: pipeline.steps,
  }))
}

export function usePipelineStepKinds() {
  return ['Idea', 'Script', 'Voice', 'Visuals', 'Edit', 'Captions', 'Thumbnail', 'Quality check', 'Upload', 'Schedule', 'Research', 'Review']
}

// ============================================================================
// SCHEDULE ADAPTERS
// ============================================================================

export function useScheduledVideoRows() {
  const scheduledVideos = useScheduledVideos()
  const { state } = useStore()
  const channels = useChannels()
  
  return scheduledVideos.map((video) => ({
    id: video.id,
    title: video.title,
    thumbnail: video.thumbnail,
    channel: channels.find((ch) => ch.id === video.channelId)?.name || 'Unassigned',
    pipeline: state.pipelines.get(video.pipelineId)?.name ?? 'Unassigned',
    scheduledAt: video.scheduledAt,
    status: video.status,
  }))
}

export function useScheduleStatusTone(): Record<ScheduleStatus, 'blue' | 'green' | 'amber' | 'red'> {
  return {
    Scheduled: 'blue',
    Ready: 'green',
    Processing: 'amber',
    'Needs attention': 'red',
  }
}

// ============================================================================
// DASHBOARD DATA ADAPTERS
// ============================================================================

const dashboardReferenceTime = Date.now()

export function useDashboardData() {
  const channels = useChannels()
  const content = useContent()
  const scheduledVideos = useScheduledVideos()
  const activities = useStore().state.activities
  
  const connectedChannels = channels.filter((ch) => ch.status === 'connected')
  const publishedContent = content.filter((item) => item.status === 'Published')
  const scheduledContent = scheduledVideos
  const processingContent = content.filter((item) => ['Generating', 'Editing'].includes(item.status))
  
  return {
    overview: [
      { label: 'Total videos', value: String(content.length), detail: 'Across all channels' },
      { label: 'Videos scheduled', value: String(scheduledContent.length), detail: 'In this workspace' },
      { label: 'Videos processing', value: String(processingContent.length), detail: `${content.filter(item => item.status === 'Failed').length} needs attention` },
      { label: 'Videos published', value: String(publishedContent.length), detail: `Across ${connectedChannels.length} channels` },
    ],
    upcomingUploads: scheduledVideos.filter(video => new Date(video.scheduledAt).getTime() >= dashboardReferenceTime).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)).slice(0, 3).map((video) => ({
      title: video.title,
      channel: channels.find((ch) => ch.id === video.channelId)?.name || 'Unassigned',
      scheduledAt: video.scheduledAt,
      status: video.status,
      tone: video.status === 'Scheduled' ? 'blue' as const : 'amber' as const,
      thumbnail: video.thumbnail,
    })),
    recentActivity: activities.slice(0, 5).map(activity => { const item = activity.relatedContentId ? content.find(item => item.id === activity.relatedContentId) : undefined; return item ? { ...activity, detail: `${item.title} · ${channels.find(channel => channel.id === item.channelId)?.name ?? 'Unassigned'}` } : activity }),
    pipelineStages: [
      { name: 'Ideas', jobs: content.filter((item) => item.status === 'Idea').length, color: 'purple' },
      { name: 'Scripting', jobs: content.filter((item) => item.status === 'Script').length, color: 'blue' },
      { name: 'Processing', jobs: processingContent.length, color: 'amber' },
      { name: 'Review', jobs: content.filter((item) => item.status === 'Ready').length, color: 'green' },
    ],
  }
}
export function useAnalyticsRows() {
  const { state } = useStore()
  return Array.from(state.analytics.values()).map(video => ({ ...video,
    title: state.content.get(video.contentId)?.title ?? video.title,
    channel: state.channels.get(video.channelId)?.name ?? 'Unassigned',
    pipeline: state.pipelines.get(video.pipelineId)?.name ?? 'Unassigned',
  }))
}
