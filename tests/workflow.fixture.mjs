import assert from 'node:assert/strict'
import { getMockInitialState } from '../src/state/mockData.ts'
import { createResetWorkspace, deserializeWorkspace, serializeWorkspace } from '../src/state/persistence.ts'
import { executeOperation } from '../src/state/operations.ts'
import { executePipelineCommand, nextExecutionDelay } from '../src/execution/engine.ts'
import { queueCommand, reconcileJobQueue, tickJobQueue } from '../src/execution/queue.ts'

export function createWorkflowHarness() {
  const seed = getMockInitialState()
  let state = createResetWorkspace()
  state.preferences = { ...state.preferences, workspaceName: 'Workflow workspace', timezone: 'Asia/Kolkata' }
  let now = Date.parse('2030-01-01T10:00:00Z')
  const commit = outcome => { assert.equal(outcome.result.ok, true, JSON.stringify(outcome.result)); state = reconcileJobQueue(outcome.state, now) }
  const operation = op => commit(executeOperation(state, op, new Date(now)))
  const command = cmd => commit(executePipelineCommand(state, cmd, now))
  operation({ type: 'save', kind: 'channel', mode: 'create', value: { ...seed.channels.get('channel-3'), id: 'workflow-channel', name: 'Workflow Channel', handle: '@workflow', status: 'connected', scheduleDays: '', defaultPipelineId: null, recentUploads: [] } })
  operation({ type: 'save', kind: 'provider', mode: 'create', value: { ...seed.providers.get('provider-openai'), id: 'workflow-provider', name: 'Workflow Provider', enabled: true, connected: false } })
  const steps = seed.pipelines.get('pipeline-long-form').steps.map(step => ({ ...step, config: { providerId: ['Idea', 'Script', 'Captions', 'Quality check'].includes(step.kind) ? 'workflow-provider' : null, instructions: `Mock instructions for ${step.kind}` } }))
  operation({ type: 'save', kind: 'pipeline', mode: 'create', value: { ...seed.pipelines.get('pipeline-long-form'), id: 'workflow-pipeline', name: 'Workflow Pipeline', assignedChannelIds: ['workflow-channel'], steps } })
  operation({ type: 'save', kind: 'content', mode: 'create', value: { ...seed.content.get('content-1'), id: 'workflow-content', title: 'Workflow Idea', channelId: 'workflow-channel', pipelineId: 'workflow-pipeline', status: 'Idea', scheduledAt: '', publishPreference: 'Decide later' } })
  const start = (options = {}) => command({ type: 'start', contentId: 'workflow-content', jobId: 'workflow-run', options: { reviewBeforePublishing: true, durationMs: 5, ...options } })
  const tick = (ms = 0) => { now += ms; state = tickJobQueue(state, now) }
  const finishPreparation = () => {
    for (let i = 0; i < 100; i++) {
      const delay = nextExecutionDelay(state, now)
      if (delay === null) break
      tick(delay)
    }
  }
  const restore = () => { state = deserializeWorkspace(serializeWorkspace(state)) }
  const queueAction = (id, action) => commit(queueCommand(state, id, action, now))
  return { get state() { return state }, set state(value) { state = value }, get now() { return now }, set now(value) { now = value }, operation, command, start, tick, finishPreparation, restore, queueAction, get item() { return state.content.get('workflow-content') }, get run() { return state.jobs.get('workflow-run') } }
}
