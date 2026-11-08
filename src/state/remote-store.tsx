import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { StoreContext, type AppActions, type AppState, type StoreContextValue } from './store'
import { collectionKeys, type EntityKind } from './operations'
import type { OperationResult } from './validation'
import { useAuth } from '../auth/AuthProvider'
import { emptyWorkspace, fetchWorkspace, paths, preferenceBody, writeBody, type RecordData } from '../api/workspace'
import { ApiError } from '../api/client'
import { Button, Card } from '../components/ui'

const failure = (message: string, errors: Record<string, string> = {}): OperationResult => ({ ok: false, kind: 'failure', message, errors })
export function RemoteStoreProvider({ children }: { children: ReactNode }) {
  const { api, user, logout } = useAuth()
  const [state, setState] = useState<AppState>(emptyWorkspace)
  const current = useRef(state)
  const [notice, setNotice] = useState<OperationResult | null>(null)
  const [loadError, setLoadError] = useState('')
  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<StoreContextValue['pendingDelete']>(null)
  const deletion = useRef<StoreContextValue['pendingDelete']>(null)
  const [pendingReset, setPendingReset] = useState(false)
  const resetRequested = useRef(false)
  const [workspaceRevision, setRevision] = useState(0)
  const busy = useRef(false), unsynced = useRef(false), mounted = useRef(true), epoch = useRef(0)
  const loading = useRef<AbortController | null>(null)
  const refresh = useCallback(async () => {
    const version = ++epoch.current
    loading.current?.abort(); const controller = new AbortController(); loading.current = controller
    try {
      const next = await fetchWorkspace(api, controller.signal)
      if (!mounted.current || version !== epoch.current) return
      const previous = current.current
      next.selectedChannelId = next.channels.has(previous.selectedChannelId ?? '') ? previous.selectedChannelId : null
      next.selectedContentId = next.content.has(previous.selectedContentId ?? '') ? previous.selectedContentId : null
      next.selectedPipelineId = next.pipelines.has(previous.selectedPipelineId ?? '') ? previous.selectedPipelineId : null
      current.current = next; setState(next); setReady(true); setLoadError(''); unsynced.current = false
    } catch (error) {
      if (controller.signal.aborted || !mounted.current || version !== epoch.current) return
      unsynced.current = true; setLoadError(error instanceof Error ? error.message : 'Could not load the server workspace.'); throw error
    }
  }, [api])
  useEffect(() => {
    mounted.current = true; void refresh().catch(() => {})
    const timer = window.setInterval(() => { if (!busy.current && !document.hidden) void refresh().catch(() => {}) }, 5000)
    return () => { mounted.current = false; epoch.current++; loading.current?.abort(); clearInterval(timer) }
  }, [refresh])
  const mutate = async (path: string, method: string, body?: unknown): Promise<OperationResult> => {
    if (busy.current) return failure('Another change is being saved. Please wait.')
    if (unsynced.current) return failure('Refresh the server workspace successfully before making another change.')
    busy.current = true; setSaving(true); setNotice(null); epoch.current++; loading.current?.abort()
    let committed = false
    let entityId: string | undefined
    let result: OperationResult
    try {
      const response = await api.request<{ data?: { id?: string } }>(path, method, body)
      committed = true; entityId = response?.data?.id
      await refresh()
      result = { ok: true, message: 'Changes saved to your account.', ...(entityId ? { entityId } : {}) }
    } catch (error) {
      if (committed) result = { ok: true, message: 'Saved on the server, but refresh failed. Retry refreshing before further edits.', ...(entityId ? { entityId } : {}) }
      else {
        if (error instanceof ApiError && error.status === 0) { unsynced.current = true; setLoadError('The outcome is uncertain. Refresh to inspect server state before retrying.') }
        result = failure(error instanceof Error ? error.message : 'The server change failed.', error instanceof ApiError ? error.fields : {})
      }
    } finally { busy.current = false; if (mounted.current) setSaving(false) }
    if (mounted.current) setNotice(result)
    return result
  }
  const save = async (kind: EntityKind, value: RecordData, id?: string) => {
    try {
      const body = writeBody(kind, value, current.current, !!id)
      return await mutate(`/api/v1/${paths[kind]}${id ? `/${id}${kind === 'pipeline' ? '/configuration' : ''}` : ''}`, id ? kind === 'pipeline' ? 'PUT' : 'PATCH' : 'POST', body)
    } catch (error) { const result = failure(error instanceof Error ? error.message : 'Invalid request'); setNotice(result); return result }
  }
  const update = (kind: EntityKind, id: string, fields: RecordData) => {
    const row = current.current[collectionKeys[kind]].get(id)
    return row ? save(kind, { ...row, ...fields }, id) : Promise.resolve(failure('This record is no longer available. Refresh the workspace.'))
  }
  const remove = (kind: EntityKind, id: string) => mutate(`/api/v1/${paths[kind]}/${id}`, 'DELETE')
  const unsupported = () => { const result = failure('This operation is not exposed by the backend. No local-only change was made.'); setNotice(result); return result }
  const select = (key: 'selectedChannelId' | 'selectedContentId' | 'selectedPipelineId', id: string | null): OperationResult => { const next = { ...current.current, [key]: id }; current.current = next; setState(next); return { ok: true, message: 'Selection updated.' } }
  const job = (id: string, action: string) => mutate(`/api/v1/jobs/${id}`, 'PATCH', { action })
  const actions: AppActions = {
    addChannel: value => save('channel', value), updateChannel: (id, value) => update('channel', id, value), deleteChannel: id => remove('channel', id), selectChannel: id => select('selectedChannelId', id),
    addProvider: value => save('provider', value), updateProvider: (id, value) => update('provider', id, value), deleteProvider: id => remove('provider', id), toggleProvider: id => update('provider', id, { enabled: !current.current.providers.get(id)?.enabled }),
    addContent: value => save('content', value), updateContent: (id, value) => update('content', id, value), deleteContent: id => remove('content', id), updateContentStatus: (id, status) => update('content', id, { status, ...(status === 'Published' ? { publishPreference: 'Publish manually when ready' } : {}) }), selectContent: id => select('selectedContentId', id),
    addPipeline: value => save('pipeline', value), updatePipeline: (id, value) => update('pipeline', id, value), deletePipeline: id => remove('pipeline', id), togglePipeline: id => update('pipeline', id, { enabled: !current.current.pipelines.get(id)?.enabled }), updatePipelineStep: (pipelineId, stepId, value) => { const pipeline = current.current.pipelines.get(pipelineId); return pipeline ? update('pipeline', pipelineId, { steps: pipeline.steps.map(step => step.id === stepId ? { ...step, ...value } : step) }) : unsupported() }, selectPipeline: id => select('selectedPipelineId', id),
    addScheduledVideo: value => save('schedule', value), updateScheduledVideo: (id, value) => update('schedule', id, value), deleteScheduledVideo: id => remove('schedule', id), updateScheduleStatus: unsupported,
    addJob: value => mutate('/api/v1/jobs', 'POST', { contentId: value.contentId }), updateJob: unsupported, updateJobStatus: unsupported, deleteJob: id => mutate(`/api/v1/jobs/${id}`, 'DELETE'), startExecution: contentId => mutate('/api/v1/jobs', 'POST', { contentId, idempotencyKey: crypto.randomUUID() }), pauseExecution: id => job(id, 'pause'), resumeExecution: id => job(id, 'resume'), cancelExecution: id => job(id, 'cancel'), retryExecution: id => job(id, 'retry'), failExecution: unsupported, cancelQueueJob: id => job(id, 'cancel'), retryQueueJob: id => job(id, 'retry'),
    setPreferences: value => mutate('/api/v1/preferences', 'PATCH', preferenceBody(value)), updatePreferences: value => mutate('/api/v1/preferences', 'PATCH', preferenceBody({ ...current.current.preferences, ...value })),
    addAnalytics: value => mutate('/api/v1/analytics', 'POST', { contentId: value.contentId, views: String(value.views), watchTimeHours: String(value.watchTimeHours), averageDurationSeconds: String(value.averageDurationSeconds), engagementRate: value.engagementRate, subscribersGained: value.subscribersGained }), updateAnalytics: (id, value) => mutate(`/api/v1/analytics/${id}`, 'PATCH', Object.fromEntries(Object.entries(value).filter(([key]) => ['views', 'watchTimeHours', 'averageDurationSeconds', 'engagementRate', 'subscribersGained'].includes(key)).map(([key, item]) => [key, ['engagementRate', 'subscribersGained'].includes(key) ? item : String(item)]))), deleteAnalytics: id => mutate(`/api/v1/analytics/${id}`, 'DELETE'),
    addActivity: unsupported, clearActivities: unsupported, initializeState: unsupported,
    requestDelete: (kind, id) => { const row = current.current[collectionKeys[kind]].get(id); if (!row) return; deletion.current = { kind, id, name: 'name' in row ? row.name : row.title }; setPendingDelete(deletion.current) }, cancelDelete: () => { deletion.current = null; setPendingDelete(null) }, confirmDelete: async () => { if (!deletion.current) return failure('Choose a record first.'); const result = await remove(deletion.current.kind, deletion.current.id); if (result.ok) { deletion.current = null; setPendingDelete(null) } return result }, dismissNotice: () => setNotice(null),
    requestReset: () => { resetRequested.current = true; setPendingReset(true) }, cancelReset: () => { resetRequested.current = false; setPendingReset(false) }, resetState: async () => { if (!resetRequested.current) return failure('Confirm the reset first.'); const result = await mutate('/api/v1/workspace/reset', 'POST', { confirmation: 'RESET' }); if (result.ok) { resetRequested.current = false; setPendingReset(false); setRevision(value => value + 1) } return result }, retryPersistence: () => { void refresh().catch(() => {}) },
  }
  if (!ready) return <main className="auth-screen"><Card><h1>{loadError ? 'Workspace unavailable' : 'Loading your workspace'}</h1><p role={loadError ? 'alert' : 'status'}>{loadError || 'Reading your account from the backend…'}</p><Button onClick={() => void refresh().catch(() => {})}>Retry loading</Button><Button onClick={() => void logout().catch(error => setLoadError(error.message))}>Sign out</Button></Card></main>
  return <StoreContext.Provider value={{ state, actions, notice, pendingDelete, pendingReset, persistenceStatus: null, workspaceRevision, remote: true, reload: refresh, saving, syncError: loadError }}><div key={`${user?.id}:${workspaceRevision}`}>{children}</div></StoreContext.Provider>
}
