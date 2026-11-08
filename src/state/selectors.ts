import type { AppState } from './store'
import { executionIsOpen } from '../execution/engine.ts'

/** Shared projections; the entities and jobs remain the only source of truth. */
export function workspaceCounts(state: AppState) {
  const jobs = [...state.jobs.values()]
  const content = [...state.content.values()]
  return {
    content: content.length,
    scheduled: [...state.scheduledVideos.values()].filter(item => item.status === 'Scheduled').length,
    published: content.filter(item => item.status === 'Published').length,
    processing: jobs.filter(job => job.status === 'running' && !(job.execution?.paused ?? job.paused)).length,
    failed: jobs.filter(job => job.status === 'failed').length,
    queued: jobs.filter(job => job.status === 'pending' && !(job.execution?.paused ?? job.paused)).length,
  }
}
export const contentJobs = (state: AppState, contentId: string) => [...state.jobs.values()].filter(job => job.contentId === contentId)
export const pipelineJobs = (state: AppState, pipelineId: string) => [...state.jobs.values()].filter(job => (job.execution?.pipelineId ?? job.queue?.pipelineId) === pipelineId)
export const channelContent = (state: AppState, channelId: string) => [...state.content.values()].filter(item => item.channelId === channelId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
export function suggestedScheduleMode(state: AppState, contentId: string): 'pipeline' | 'publication' {
  const item = state.content.get(contentId)
  return item?.status === 'Ready' && contentJobs(state, contentId).some(job => job.execution?.status === 'COMPLETED' && job.execution.pipelineId === item.pipelineId) ? 'publication' : 'pipeline'
}
export function workflowBlocker(state: AppState, contentId: string): string | null {
  const item = state.content.get(contentId)
  if (!item) return 'This content was removed. Close these details and choose an available item.'
  if (!state.channels.has(item.channelId)) return 'Choose an available channel before running this content.'
  const pipeline = state.pipelines.get(item.pipelineId)
  if (!pipeline) return 'Choose an available pipeline before running this content.'
  if (!pipeline.enabled) return 'Enable this pipeline or choose another one before starting a run.'
  if (pipeline.assignedChannelIds.length && !pipeline.assignedChannelIds.includes(item.channelId)) return 'Assign this content’s channel to the pipeline before starting a run.'
  return null
}
export function canScheduleContent(state: AppState, contentId: string): boolean {
  const item = state.content.get(contentId)
  return item?.status === 'Ready' && !item.scheduledAt && !contentJobs(state, contentId).some(job => executionIsOpen(job) || job.queue && ['pending', 'running'].includes(job.status))
}
