import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { createServer } from 'vite'

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
try {
  const pages = await server.ssrLoadModule('/src/pages.tsx')
  const { StoreProvider, useStore } = await server.ssrLoadModule('/src/state/store.tsx')
  const { getMockInitialState } = await server.ssrLoadModule('/src/state/mockData.ts')
  const { ContentEditor, ChannelEditor, ScheduleEditor } = await server.ssrLoadModule('/src/components/EntityEditors.tsx')
  const { OperationFeedback, FieldError, WorkspaceFeedback, WorkspaceErrorBoundary, useSubmission } = await server.ssrLoadModule('/src/components/feedback.tsx')
  const { MemoryRouter } = await import('react-router-dom')
  // Settings reads the hash to select its initial section.
  globalThis.window = { location: { hash: '' } }
  for (const initialState of [getMockInitialState(), { ...getMockInitialState(), channels: new Map(), content: new Map(), providers: new Map(), pipelines: new Map(), scheduledVideos: new Map(), analytics: new Map(), activities: [] }]) {
    for (const name of ['AnalyticsPage', 'ChannelsPage', 'ContentPage', 'DashboardPage', 'ProvidersPage', 'SchedulerPage', 'SettingsPage', 'WorkflowsPage']) {
      const Page = pages[name]
      const html = renderToString(createElement(MemoryRouter, null, createElement(StoreProvider, { initialState }, createElement(Page, { onCreate() {} }))))
      assert.ok(html.includes('<h1'), name)
      assert.ok(!html.includes('NaN'), name)
    }
    for (const Editor of [ContentEditor, ChannelEditor, ScheduleEditor]) {
      const html = renderToString(createElement(MemoryRouter, null, createElement(StoreProvider, { initialState }, createElement(Editor, { onClose() {} }))))
      assert.ok(html.includes('role="dialog"'))
      assert.ok(html.includes('Save changes'))
    }
  }
  const initialState = getMockInitialState()
  const close = () => {}
  const success = () => ({ ok: true, message: 'Saved.' })
  for (const [Dialog, props] of [[pages.ProviderDialog, { provider: null, onSave: success }], [pages.PipelineBuilderDialog, { pipeline: null, onSave: success }], [pages.SchedulerDetailsDialog, { item: { ...initialState.scheduledVideos.get('schedule-1'), channel: 'Mindful Minutes', pipeline: 'Shorts repurpose' }, onReschedule: success }]]) {
    const html = renderToString(createElement(MemoryRouter, null, createElement(StoreProvider, { initialState }, createElement(Dialog, { ...props, onClose: close }))))
    assert.ok(html.includes('role="dialog"'))
    if (Dialog !== pages.SchedulerDetailsDialog) assert.ok(html.includes('noValidate=""'))
  }
  console.log('PASS: all 8 pages and 6 editors/detail dialogs render, including populated and empty collections')
  const failure = { ok: false, kind: 'failure', message: 'Your changes could not be saved. Please try again.', errors: {} }
  const invalid = { ok: false, kind: 'validation', message: 'Please fix the highlighted fields and try again.', errors: { title: 'Content title is required.' } }
  assert.ok(renderToString(createElement(OperationFeedback, { result: null, pending: true })).includes('role="status"'))
  assert.ok(renderToString(createElement(OperationFeedback, { result: null, pending: true })).includes('Saving changes'))
  assert.ok(renderToString(createElement(OperationFeedback, { result: { ok: true, message: 'Content created.' } })).includes('operation-success'))
  assert.ok(renderToString(createElement(OperationFeedback, { result: invalid })).includes('role="alert"'))
  assert.ok(renderToString(createElement(OperationFeedback, { result: invalid })).includes('Content title is required.'))
  assert.ok(renderToString(createElement(OperationFeedback, { result: failure })).includes('Please try again'))
  assert.ok(renderToString(createElement(OperationFeedback, { result: failure, onDismiss() {} })).includes('Dismiss message'))
  assert.ok(renderToString(createElement(FieldError, { submission: { error: () => 'Choose a channel.', errorId: () => 'channel-error' }, field: 'channelId' })).includes('id="channel-error"'))
  assert.ok(!renderToString(createElement(OperationFeedback, { result: null })))
  assert.ok(renderToString(createElement(WorkspaceErrorBoundary, null, createElement('p', null, 'Healthy view'))).includes('Healthy view'))
  let context
  function Probe({ capture }) { capture(useStore()); return null }
  renderToString(createElement(StoreProvider, { initialState: getMockInitialState() }, createElement(Probe, { capture: value => { context = value } })))
  const { actions } = context
  const value = { ...getMockInitialState().providers.get('provider-openai'), id: 'test-provider-1', name: 'Test provider' }
  assert.equal(actions.addProvider(value).ok, true)
  assert.equal(actions.addProvider({ ...value, id: 'test-provider-2' }).ok, false, 'Sequential actions must use the latest state')
  actions.requestDelete('provider', value.id)
  assert.equal(actions.updateProvider(value.id, { name: 'Still present before confirmation' }).ok, true)
  actions.cancelDelete()
  assert.equal(actions.confirmDelete().ok, false)
  assert.equal(actions.updateProvider(value.id, { name: 'Cancellation kept this provider' }).ok, true)
  actions.requestDelete('provider', value.id)
  assert.equal(actions.confirmDelete().ok, true)
  assert.equal(actions.updateProvider(value.id, { name: 'Cannot recreate a deleted provider' }).ok, false)
  assert.equal(actions.updateChannel('channel-1', { status: 'disconnected' }).ok, true)
  assert.equal(actions.togglePipeline('pipeline-long-form').ok, true)
  assert.equal(actions.updatePreferences({ defaultPipelineId: 'pipeline-long-form' }).ok, false)
  assert.equal(actions.updatePreferences({ workspaceName: '  ' }).ok, false)
  assert.equal(actions.updateContentStatus('content-1', 'Idea').ok, false)
  const shellFeedback = renderToString(createElement(StoreProvider, { initialState: getMockInitialState() }, createElement(WorkspaceFeedback)))
  assert.equal(shellFeedback, '')
  const { Select } = await server.ssrLoadModule('/src/components/ui.tsx')
  const unavailable = renderToString(createElement(Select, { value: 'deleted', onChange() {} }, createElement('option', { value: '' }, 'No default provider')))
  assert.ok(unavailable.includes('Unavailable selection'))
  assert.ok(unavailable.includes('aria-invalid="true"'))
  let submission
  function SubmissionProbe({ capture }) { capture(useSubmission()); return null }
  renderToString(createElement(SubmissionProbe, { capture: value => { submission = value } }))
  globalThis.window.setTimeout = globalThis.setTimeout
  let writes = 0
  const firstSave = submission.submit(() => { writes += 1; return { ok: true, message: 'Saved.' } })
  const secondSave = submission.submit(() => { writes += 1; return { ok: true, message: 'Saved twice.' } })
  const outcomes = await Promise.all([firstSave, secondSave])
  assert.equal(writes, 1)
  assert.equal(outcomes[0].ok, true)
  assert.equal(outcomes[1].ok, false)
  const failedSubmission = await submission.submit(() => { throw new Error('Internal diagnostic details') })
  assert.equal(failedSubmission.ok, false)
  assert.equal(JSON.stringify(failedSubmission).includes('Internal diagnostic details'), false)
  console.log('PASS: loading, success, validation, failure, empty feedback, accessible field errors, and unavailable selections render correctly')
  console.log('PASS: repeated submissions are prevented and thrown operation errors are sanitized')
  console.log('PASS: store actions serialize updates, require deletion confirmation, and preserve data on cancel or rejection')
} finally {
  delete globalThis.window
  await server.close()
}
