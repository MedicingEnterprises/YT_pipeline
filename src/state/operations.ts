import type { AIProvider, Channel, ContentItem, Pipeline, ScheduledVideo, UserPreferences } from '../models'
import type { AppState } from './store'
import { saveContent, saveSchedule, removeContent, removeSchedule, removePipeline, removeProvider, removeChannel } from './mutations.ts'
import { validateChannel, validateContent, validatePipeline, validatePreferences, validateProvider, validateSchedule, validationError, operationFailure, type OperationResult, type FieldErrors } from './validation.ts'
import { executionOperationError } from '../execution/engine.ts'
import { queueOperationError } from '../execution/queue.ts'
import { recordWorkspaceActivity } from './activity.ts'

export type EntityKind = 'channel' | 'provider' | 'content' | 'pipeline' | 'schedule'
export type EntityTypes = { channel: Channel; provider: AIProvider; content: ContentItem; pipeline: Pipeline; schedule: ScheduledVideo }
export type SaveOperation = { [K in EntityKind]: { type: 'save'; kind: K; mode: 'create' | 'update'; value: EntityTypes[K]; targetId?: string } }[EntityKind]
export type Operation = SaveOperation | { type: 'delete'; kind: EntityKind; id: string } | { type: 'preferences'; value: UserPreferences }
export const collectionKeys = { channel: 'channels', provider: 'providers', content: 'content', pipeline: 'pipelines', schedule: 'scheduledVideos' } as const

export function executeOperation(state: AppState, operation: Operation, instant = new Date()): { state: AppState; result: OperationResult } {
  try {
    const executionError = executionOperationError(state, operation) ?? queueOperationError(state, operation)
    if (executionError) return { state, result: validationError({ execution: executionError }) }
    if (operation.type === 'preferences') {
      const errors = validatePreferences(operation.value, state)
      if (Object.keys(errors).length) return { state, result: validationError(errors) }
      return { state: recordWorkspaceActivity({ ...state, preferences: { ...operation.value, workspaceName: operation.value.workspaceName.trim(), updatedAt: instant.toISOString() } }, { title: 'Workspace preferences updated', detail: operation.value.workspaceName.trim() }, instant), result: { ok: true, message: 'Preferences saved across your workspace.' } }
    }
    const collection = state[collectionKeys[operation.kind]]
    const id = operation.type === 'save' ? operation.value.id : operation.id
    const reject = (errors: FieldErrors) => ({ state, result: validationError(errors) })
    if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(id)) return reject({ id: 'This item could not be identified. Close the form and create it again.' })
    if (operation.type === 'delete') {
      if (!collection.has(id)) return { state, result: { ok: false, kind: 'failure', message: 'This item is no longer available. Close the dialog and refresh the list.', errors: {} } }
      if (operation.kind === 'channel' && Array.from(state.content.values()).some(item => item.channelId === id)) return reject({ channel: 'Reassign or delete this channel’s content before deleting the channel.' })
      const remove = { channel: removeChannel, provider: removeProvider, content: removeContent, pipeline: removePipeline, schedule: removeSchedule }[operation.kind]
      const previous = collection.get(id)!
      const detail = 'name' in previous ? previous.name : previous.title
      return { state: recordWorkspaceActivity(remove(state, id), { title: `${operation.kind} deleted`, detail, ...('channelId' in previous ? { relatedChannelId: previous.channelId } : {}), ...(operation.kind === 'channel' ? { relatedChannelId: id } : operation.kind === 'provider' ? { relatedProviderId: id } : operation.kind === 'pipeline' ? { relatedPipelineId: id } : {}) }, instant), result: { ok: true, message: `${operation.kind === 'schedule' ? 'Schedule' : operation.kind[0].toUpperCase() + operation.kind.slice(1)} deleted.` } }
    }
    if (operation.targetId && operation.targetId !== id) return reject({ id: 'An existing item cannot be replaced with a different item. Close and reopen the form.' })
    if (operation.mode === 'create' && collection.has(id)) return reject({ id: 'This item already exists. Close the form and add a new item.' })
    if (operation.mode === 'update' && !collection.has(id)) return { state, result: { ok: false, kind: 'failure', message: 'This item was removed while you were editing. Close the form and choose an available item.', errors: {} } }
    let errors: FieldErrors
    switch (operation.kind) {
      case 'channel': errors = validateChannel(operation.value, state); break
      case 'provider': errors = validateProvider(operation.value, state); break
      case 'content': errors = validateContent(operation.value, state, instant); break
      case 'pipeline': errors = validatePipeline(operation.value, state); break
      case 'schedule': errors = validateSchedule(operation.value, state, instant); break
    }
    if (Object.keys(errors).length) return reject(errors)
    const stamp = instant.toISOString()
    let next: AppState
    switch (operation.kind) {
      case 'channel': {
        const channels = new Map(state.channels)
        channels.set(id, { ...operation.value, name: operation.value.name.trim(), handle: operation.value.handle.trim(), updatedAt: stamp })
        next = { ...state, channels }; break
      }
      case 'provider': {
        const providers = new Map(state.providers)
        providers.set(id, { ...operation.value, name: operation.value.name.trim(), models: operation.value.models.map(model => model.trim()), updatedAt: stamp })
        let preferences = state.preferences
        if (preferences) {
          preferences = { ...preferences }
          for (const [key, category] of [['textProviderId', 'Text generation'], ['voiceProviderId', 'Text-to-speech'], ['imageProviderId', 'Image generation']] as const) if (preferences[key] === id && (!operation.value.enabled || operation.value.category !== category)) preferences[key] = null
        }
        next = { ...state, providers, preferences }; break
      }
      case 'pipeline': {
        const pipelines = new Map(state.pipelines)
        pipelines.set(id, { ...operation.value, name: operation.value.name.trim(), updatedAt: stamp })
        next = { ...state, pipelines, preferences: state.preferences && { ...state.preferences, defaultPipelineId: !operation.value.enabled && state.preferences.defaultPipelineId === id ? null : state.preferences.defaultPipelineId } }; break
      }
      case 'content': next = saveContent(state, { ...operation.value, title: operation.value.title.trim() }); break
      case 'schedule': next = saveSchedule(state, operation.value); break
    }
    if (operation.kind === 'channel' || operation.kind === 'provider' || operation.kind === 'pipeline') next = recordWorkspaceActivity(next, { title: `${operation.kind} ${operation.mode === 'create' ? 'created' : 'updated'}`, detail: operation.value.name.trim(), ...(operation.kind === 'channel' ? { relatedChannelId: id } : operation.kind === 'provider' ? { relatedProviderId: id } : { relatedPipelineId: id }) }, instant)
    return { state: next, result: { ok: true, message: `${operation.kind === 'schedule' ? 'Schedule' : operation.kind[0].toUpperCase() + operation.kind.slice(1)} ${operation.mode === 'create' ? 'created' : 'updated'}.` } }
  } catch {
    // Never reveal thrown messages or stack traces to a user, or commit partially changed state.
    return { state, result: operationFailure() }
  }
}
