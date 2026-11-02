import { createContext, useContext, useRef, useState, type ReactNode } from 'react'
import type { Channel, AIProvider, ContentItem, Pipeline, ScheduledVideo, Job, UserPreferences, AnalyticsVideo, Activity, PipelineStep, ContentStatus, ScheduleStatus, JobStatus } from '../models'
import { executeOperation, collectionKeys, type Operation, type EntityKind, type EntityTypes, type SaveOperation } from './operations'
import { validationError, type OperationResult } from './validation'

export interface AppState {
  // Entities
  channels: Map<string, Channel>
  providers: Map<string, AIProvider>
  content: Map<string, ContentItem>
  pipelines: Map<string, Pipeline>
  scheduledVideos: Map<string, ScheduledVideo>
  jobs: Map<string, Job>
  preferences: UserPreferences | null
  analytics: Map<string, AnalyticsVideo>
  activities: Activity[]
  
  // Active selections
  selectedChannelId: string | null
  selectedContentId: string | null
  selectedPipelineId: string | null
}

interface AppActions {
  // Channel operations
  addChannel: (channel: Channel) => OperationResult
  updateChannel: (id: string, updates: Partial<Channel>) => OperationResult
  deleteChannel: (id: string) => OperationResult
  selectChannel: (id: string | null) => OperationResult
  
  // Provider operations
  addProvider: (provider: AIProvider) => OperationResult
  updateProvider: (id: string, updates: Partial<AIProvider>) => OperationResult
  deleteProvider: (id: string) => OperationResult
  toggleProvider: (id: string) => OperationResult
  
  // Content operations
  addContent: (content: ContentItem) => OperationResult
  updateContent: (id: string, updates: Partial<ContentItem>) => OperationResult
  deleteContent: (id: string) => OperationResult
  updateContentStatus: (id: string, status: ContentStatus) => OperationResult
  selectContent: (id: string | null) => OperationResult
  
  // Pipeline operations
  addPipeline: (pipeline: Pipeline) => OperationResult
  updatePipeline: (id: string, updates: Partial<Pipeline>) => OperationResult
  deletePipeline: (id: string) => OperationResult
  togglePipeline: (id: string) => OperationResult
  updatePipelineStep: (pipelineId: string, stepId: string, updates: Partial<PipelineStep>) => OperationResult
  selectPipeline: (id: string | null) => OperationResult
  
  // Schedule operations
  addScheduledVideo: (video: ScheduledVideo) => OperationResult
  updateScheduledVideo: (id: string, updates: Partial<ScheduledVideo>) => OperationResult
  deleteScheduledVideo: (id: string) => OperationResult
  updateScheduleStatus: (id: string, status: ScheduleStatus) => OperationResult
  
  // Job operations
  addJob: (job: Job) => OperationResult
  updateJob: (id: string, updates: Partial<Job>) => OperationResult
  deleteJob: (id: string) => OperationResult
  updateJobStatus: (id: string, status: JobStatus) => OperationResult
  
  // Preferences operations
  setPreferences: (preferences: UserPreferences) => OperationResult
  updatePreferences: (updates: Partial<UserPreferences>) => OperationResult
  
  // Analytics operations
  addAnalytics: (analytics: AnalyticsVideo) => OperationResult
  updateAnalytics: (id: string, updates: Partial<AnalyticsVideo>) => OperationResult
  deleteAnalytics: (id: string) => OperationResult
  
  // Activity operations
  addActivity: (activity: Activity) => OperationResult
  clearActivities: () => OperationResult
  
  requestDelete: (kind: EntityKind, id: string) => void
  cancelDelete: () => void
  confirmDelete: () => OperationResult
  dismissNotice: () => void
  // Bulk operations
  initializeState: (state: Partial<AppState>) => OperationResult
  resetState: () => OperationResult
}


interface StoreContextValue {
  state: AppState
  actions: AppActions
  notice: OperationResult | null
  pendingDelete: { kind: EntityKind; id: string; name: string } | null
}
const StoreContext = createContext<StoreContextValue | null>(null)
const createInitialState = (): AppState => ({ channels: new Map(), providers: new Map(), content: new Map(), pipelines: new Map(), scheduledVideos: new Map(), jobs: new Map(), preferences: null, analytics: new Map(), activities: [], selectedChannelId: null, selectedContentId: null, selectedPipelineId: null })
export function useStore(): StoreContextValue {
  const context = useContext(StoreContext)
  if (!context) throw new Error('useStore must be used within a StoreProvider')
  return context
}
export function StoreProvider({ children, initialState }: { children: ReactNode; initialState?: Partial<AppState> }) {
  const [state, setState] = useState<AppState>(() => ({ ...createInitialState(), ...initialState }))
  const current = useRef(state)
  const [notice, setNotice] = useState<OperationResult | null>(null)
  const [pendingDelete, setPendingDelete] = useState<StoreContextValue['pendingDelete']>(null)
  const deletion = useRef<StoreContextValue['pendingDelete']>(null)
  const commit = (next: AppState) => { current.current = next; setState(next) }
  const run = (operation: Operation): OperationResult => {
    const outcome = executeOperation(current.current, operation)
    if (outcome.result.ok) commit(outcome.state)
    setNotice(outcome.result)
    return outcome.result
  }
  const save = <K extends EntityKind>(kind: K, value: EntityTypes[K], mode: 'create' | 'update', targetId?: string) => run({ type: 'save', kind, value, mode, targetId } as SaveOperation)
  const update = <K extends EntityKind>(kind: K, id: string, updates: Partial<EntityTypes[K]>) => {
    const item = current.current[collectionKeys[kind]].get(id)
    // Keep the target ID separate so updates cannot rename identifiers or recreate removed records.
    return save(kind, { ...item, id, ...updates } as EntityTypes[K], 'update', id)
  }
  const select = (key: 'selectedChannelId' | 'selectedContentId' | 'selectedPipelineId', id: string | null): OperationResult => {
    const map = key === 'selectedChannelId' ? current.current.channels : key === 'selectedContentId' ? current.current.content : current.current.pipelines
    if (id && !map.has(id)) { const result = validationError({ selection: 'Choose an available item.' }); setNotice(result); return result }
    commit({ ...current.current, [key]: id }); return { ok: true, message: 'Selection updated.' }
  }
  const toggle = (kind: 'provider' | 'pipeline', id: string) => {
    const item = current.current[collectionKeys[kind]].get(id)
    return update(kind, id, { enabled: !item?.enabled })
  }
  const remove = (kind: EntityKind, id: string) => run({ type: 'delete', kind, id })
  const raw = (change: (state: AppState) => AppState): OperationResult => { commit(change(current.current)); return { ok: true, message: 'Workspace updated.' } }
  const actions: AppActions = {
    addChannel: value => save('channel', value, 'create'), updateChannel: (id, updates) => update('channel', id, updates), deleteChannel: id => remove('channel', id), selectChannel: id => select('selectedChannelId', id),
    addProvider: value => save('provider', value, 'create'), updateProvider: (id, updates) => update('provider', id, updates), deleteProvider: id => remove('provider', id), toggleProvider: id => toggle('provider', id),
    addContent: value => save('content', value, 'create'), updateContent: (id, updates) => update('content', id, updates), deleteContent: id => remove('content', id), updateContentStatus: (id, status) => {
      const item = current.current.content.get(id)
      return update('content', id, { status, ...(status === 'Published' ? { scheduledAt: '', publishPreference: 'Publish manually when ready' as const } : {}), ...(status === 'Ready' && item?.status === 'Scheduled' ? { scheduledAt: '', publishPreference: 'Decide later' as const } : {}) })
    }, selectContent: id => select('selectedContentId', id),
    addPipeline: value => save('pipeline', value, 'create'), updatePipeline: (id, updates) => update('pipeline', id, updates), deletePipeline: id => remove('pipeline', id), togglePipeline: id => toggle('pipeline', id), updatePipelineStep: (pipelineId, stepId, updates) => {
      const pipeline = current.current.pipelines.get(pipelineId)
      if (!pipeline?.steps.some(step => step.id === stepId)) { const result = validationError({ step: 'This step is no longer available. Reopen the pipeline.' }); setNotice(result); return result }
      return update('pipeline', pipelineId, { steps: pipeline.steps.map(step => step.id === stepId ? { ...step, ...updates } : step) })
    }, selectPipeline: id => select('selectedPipelineId', id),
    addScheduledVideo: value => save('schedule', value, 'create'), updateScheduledVideo: (id, updates) => update('schedule', id, updates), deleteScheduledVideo: id => remove('schedule', id), updateScheduleStatus: (id, status) => update('schedule', id, { status }),
    setPreferences: value => run({ type: 'preferences', value }), updatePreferences: updates => {
      if (!current.current.preferences) { const result: OperationResult = { ok: false, kind: 'failure', message: 'Workspace preferences are unavailable. Reload the workspace and try again.', errors: {} }; setNotice(result); return result }
      return run({ type: 'preferences', value: { ...current.current.preferences, ...updates } })
    },
    addJob: value => raw(prev => ({ ...prev, jobs: new Map(prev.jobs).set(value.id, value) })), updateJob: (id, updates) => raw(prev => { const item = prev.jobs.get(id); return item ? { ...prev, jobs: new Map(prev.jobs).set(id, { ...item, ...updates, id }) } : prev }), deleteJob: id => raw(prev => ({ ...prev, jobs: new Map(Array.from(prev.jobs).filter(([key]) => key !== id)) })), updateJobStatus: (id, status) => actions.updateJob(id, { status }),
    addAnalytics: value => raw(prev => ({ ...prev, analytics: new Map(prev.analytics).set(value.id, value) })), updateAnalytics: (id, updates) => raw(prev => { const item = prev.analytics.get(id); return item ? { ...prev, analytics: new Map(prev.analytics).set(id, { ...item, ...updates, id }) } : prev }), deleteAnalytics: id => raw(prev => ({ ...prev, analytics: new Map(Array.from(prev.analytics).filter(([key]) => key !== id)) })),
    addActivity: value => raw(prev => ({ ...prev, activities: [value, ...prev.activities] })), clearActivities: () => raw(prev => ({ ...prev, activities: [] })), initializeState: updates => raw(prev => ({ ...prev, ...updates })), resetState: () => raw(() => createInitialState()),
    requestDelete: (kind, id) => {
      const item = current.current[collectionKeys[kind]].get(id)
      if (!item) { remove(kind, id); return }
      const name = 'name' in item ? item.name : item.title
      const request = { kind, id, name }
      setNotice(null); deletion.current = request; setPendingDelete(request)
    },
    cancelDelete: () => { deletion.current = null; setPendingDelete(null) },
    confirmDelete: () => {
      const request = deletion.current
      if (!request) return validationError({ confirmation: 'Choose an item to delete first.' })
      const result = remove(request.kind, request.id)
      if (result.ok) actions.cancelDelete()
      return result
    },
    dismissNotice: () => setNotice(null),
  }
  return <StoreContext.Provider value={{ state, actions, notice, pendingDelete }}>{children}</StoreContext.Provider>
}

export function useChannels() {
  const { state } = useStore()
  return Array.from(state.channels.values())
}

export function useProviders() {
  const { state } = useStore()
  return Array.from(state.providers.values())
}

export function useContent() {
  const { state } = useStore()
  return Array.from(state.content.values())
}

export function usePipelines() {
  const { state } = useStore()
  return Array.from(state.pipelines.values())
}

export function useScheduledVideos() {
  const { state } = useStore()
  return Array.from(state.scheduledVideos.values())
}

export function useJobs() {
  const { state } = useStore()
  return Array.from(state.jobs.values())
}

export function useAnalytics() {
  const { state } = useStore()
  return Array.from(state.analytics.values())
}

export function useActivities() {
  const { state } = useStore()
  return state.activities
}

export function usePreferences() {
  const { state } = useStore()
  return state.preferences
}