import { deserializeWorkspace } from '../state/persistence'
import { preferenceBody, writeBody, wireEnum, wallToInstant, type RecordData } from './workspace'

/** Read-only conversion. The source browser snapshot is never replaced/deleted. */
export function prepareImport(raw: string, replacePreferences = false): RecordData {
  if (new TextEncoder().encode(raw).length > 5 * 1024 * 1024) throw Error('The backup exceeds the 5 MB import limit.')
  const state = deserializeWorkspace(raw)
  const preferences = state.preferences!
  const timestamp = (value: string) => {
    if (!/^\d{4}-\d\d-\d\d(?:$|T.*(?:Z|[+-]\d\d:\d\d)$)/.test(value)) throw Error('A backup timestamp has no unambiguous UTC offset. Download and correct the backup before importing.')
    const date = new Date(value)
    if (!Number.isFinite(date.getTime())) throw Error('A backup timestamp is invalid.')
    return date.toISOString()
  }
  const collection = (values: Iterable<RecordData>, kind: Parameters<typeof writeBody>[0]): RecordData[] => [...values].map(row => ({ ...writeBody(kind, row, state), sourceId: row.id, createdAt: timestamp(row.createdAt), updatedAt: timestamp(row.updatedAt) }))
  return {
    version: 1, replacePreferences,
    channels: collection(state.channels.values(), 'channel'), providers: collection(state.providers.values(), 'provider'), pipelines: collection(state.pipelines.values(), 'pipeline'),
    content: collection(state.content.values(), 'content').map(row => ({ ...row, pipelineId: row.pipelineId || null })),
    schedules: collection(state.scheduledVideos.values(), 'schedule').map(row => ({ ...row, status: wireEnum(state.scheduledVideos.get(row.sourceId)!.status) })),
    jobs: [...state.jobs.values()].map(row => ({ sourceId: row.id, contentId: row.contentId, pipelineId: (row.execution?.pipelineId ?? row.queue?.pipelineId ?? state.content.get(row.contentId)?.pipelineId) || null, providerId: row.providerId, status: ({ pending: 'QUEUED', running: 'PROCESSING', completed: 'COMPLETED', failed: 'FAILED', cancelled: 'CANCELLED' })[row.status], kind: row.kind.toUpperCase(), type: row.queue?.type ?? 'PIPELINE_EXECUTION', progress: row.execution?.progress ?? 0, errorMessage: row.errorMessage, createdAt: timestamp(row.createdAt), updatedAt: timestamp(row.updatedAt), startedAt: row.startedAt ? timestamp(row.startedAt) : null, completedAt: row.completedAt ? timestamp(row.completedAt) : null, attempt: row.queue?.attempt ?? 1, history: (row.queue?.history ?? []).map(event => ({ status: ({ pending: 'QUEUED', running: 'PROCESSING', completed: 'COMPLETED', failed: 'FAILED', cancelled: 'CANCELLED' })[event.status], at: timestamp(event.at), attempt: event.attempt, message: event.message })) })),
    analytics: [...state.analytics.values()].map(row => ({ sourceId: row.id, contentId: row.contentId, recordedAt: timestamp(row.updatedAt), views: String(row.views), watchTimeHours: String(row.watchTimeHours), averageDurationSeconds: String(row.averageDurationSeconds), engagementRate: row.engagementRate, subscribersGained: row.subscribersGained, createdAt: timestamp(row.createdAt), updatedAt: timestamp(row.updatedAt) })),
    activities: state.activities.map(row => ({ sourceId: row.id, contentId: row.relatedContentId, channelId: row.relatedChannelId ?? null, pipelineId: row.relatedPipelineId ?? null, providerId: row.relatedProviderId ?? null, title: row.title, detail: row.detail, category: row.category.toUpperCase(), tone: row.tone, icon: row.icon, ...(row.createdAt ? { createdAt: timestamp(row.createdAt) } : {}) })),
    preferences: preferenceBody(preferences),
  }
}
export { wallToInstant }
