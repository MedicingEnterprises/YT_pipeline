import type { AppState } from './store'
import type { Activity } from '../models'

export function recordWorkspaceActivity(state: AppState, event: Pick<Activity, 'title' | 'detail'> & Partial<Pick<Activity, 'relatedChannelId' | 'relatedPipelineId' | 'relatedProviderId'>>, instant: Date): AppState {
  if (state.preferences?.notifyPipeline === false) return state
  const activity: Activity = { ...event, id: crypto.randomUUID(), category: 'Success', tone: 'activity-green', icon: 'Activity', relatedContentId: null, time: 'Just now', createdAt: instant.toISOString() }
  return { ...state, activities: [activity, ...state.activities].slice(0, 100) }
}
