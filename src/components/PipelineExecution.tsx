import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../state/store'
import { executionIsOpen } from '../execution/engine'
import { Button, Select } from './ui'
import { OperationFeedback, useSubmission } from './feedback'
import { contentJobs, workflowBlocker } from '../state/selectors'
import { validatePipeline } from '../state/validation'

/** Controls only: all state transitions and timers live outside this component. */
export function PipelineExecutionPanel({ contentId }: { contentId: string }) {
  const { state, actions, remote } = useStore()
  const content = state.content.get(contentId)
  const pipeline = content && state.pipelines.get(content.pipelineId)
  const jobs = contentJobs(state, contentId).filter(job => job.execution)
  const job = jobs.at(-1)
  const run = job?.execution
  const submission = useSubmission()
  const [duration, setDuration] = useState('1500')
  const [failureStep, setFailureStep] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [reviewBeforePublishing, setReviewBeforePublishing] = useState(true)
  const blocker = workflowBlocker(state, contentId)
  const configurationErrors = pipeline ? Object.values(validatePipeline(pipeline, state)) : []
  const invoke = (work: () => ReturnType<typeof actions.pauseExecution>) => { void submission.submit(work) }
  const canStart = !job || !executionIsOpen(job)
  if (remote) return <section className="page-section" aria-label="Pipeline jobs"><p className="card-kicker">PIPELINE JOBS</p><p className="dialog-note">Queue this content on the backend. Step execution and automatic publication are not connected to a backend worker yet; no local timer will modify server data.</p><Button variant="primary" disabled={submission.pending || !pipeline || ['Published', 'Scheduled'].includes(content?.status ?? '') || [...state.jobs.values()].some(item => item.contentId === contentId && ['pending', 'running'].includes(item.status))} onClick={() => invoke(() => actions.startExecution(contentId))}>Queue pipeline job</Button><OperationFeedback result={submission.result} pending={submission.pending} /></section>
  return <section className="page-section" aria-label="Mock pipeline execution">
    <p className="card-kicker">MOCK PIPELINE EXECUTION</p>
    <p className="dialog-note">Runs configured steps in this browser. No media is generated or uploaded. Runs restored after a refresh are paused until you resume.</p>
    {blocker && <p role="alert">{blocker} <Link to="/channels">Channels</Link> · <Link to="/pipelines">Pipelines</Link></p>}
    {configurationErrors.length > 0 && <div role="alert"><p>This pipeline needs attention:</p><ul>{configurationErrors.map((error, index) => <li key={index}>{error}</li>)}</ul><Link to="/providers">Configure mock providers</Link> · <Link to="/pipelines">Edit pipeline</Link></div>}
    {!run && pipeline && <details><summary>Configured steps and providers</summary><ol>{pipeline.steps.map(step => <li key={step.id}><strong>{step.kind}</strong> · {step.enabled ? 'Enabled' : 'Disabled'}<p>Provider: {step.config.providerId ? state.providers.get(step.config.providerId)?.name ?? 'Unavailable provider' : 'Built-in mock simulation'}</p><p>{step.config.instructions || 'No extra instructions.'}</p></li>)}</ol><Link to="/pipelines">Review pipeline configuration</Link></details>}
    {run && job && <>
      <p role="status"><strong>{run.paused ? `${run.status} · Paused` : run.status}</strong> · {run.progress}% · {run.completedStepIds.length}/{run.steps.length} steps completed</p>
      <progress max={100} value={run.progress} aria-label="Pipeline progress" />
      <p>Current step: {run.steps.find(step => step.id === run.currentStepId)?.kind ?? 'None'}{run.failedStepId && ` · Failed step: ${run.steps.find(step => step.id === run.failedStepId)?.kind}`}</p>
      <small>Job: {job.id} · Pipeline: {run.pipelineId}<br />Started: {job.startedAt ?? 'Not started'} · Finished: {job.completedAt ?? 'Not finished'}</small>
      {job.errorMessage && <p role="alert">{job.errorMessage}</p>}
      <ol>{run.steps.map(step => <li key={step.id}><details><summary>{step.kind} · {run.completedStepIds.includes(step.id) ? 'Completed' : run.failedStepId === step.id ? 'Failed' : run.currentStepId === step.id ? run.paused ? 'Paused' : 'Current' : 'Waiting'}</summary><p>Provider: {step.providerId ? state.providers.get(step.providerId)?.name ?? 'Unavailable provider' : 'Built-in mock simulation'} · Duration: {step.durationMs} ms</p><p>{step.instructions || 'No extra instructions.'}</p><small>Step: {step.id} · Mock step only</small></details></li>)}</ol>
      {run.status === 'COMPLETED' && content?.status === 'Ready' && <p role="status">Preparation complete. Review this content, then choose Schedule ready content below.</p>}
      {run.status === 'CANCELLED' && <p>Execution cancelled. Completed steps remain in history; you can edit the idea or explicitly start a new run.</p>}
      <div className="dialog-footer">
        {['QUEUED', 'PROCESSING'].includes(run.status) && <Button disabled={submission.pending} onClick={() => invoke(() => run.paused ? actions.resumeExecution(job.id) : actions.pauseExecution(job.id))}>{run.paused ? 'Resume' : 'Pause'}</Button>}
        {run.status === 'PROCESSING' && !run.paused && <Button disabled={submission.pending} onClick={() => invoke(() => actions.failExecution(job.id))}>Simulate failure</Button>}
        {run.status === 'FAILED' && <Button disabled={submission.pending} onClick={() => invoke(() => actions.retryExecution(job.id))}>Retry failed step</Button>}
        {executionIsOpen(job) && <Button disabled={submission.pending} onClick={() => invoke(() => actions.cancelExecution(job.id))}>Cancel execution</Button>}
      </div>
    </>}
    {canStart && content && !['Published', 'Scheduled'].includes(content.status) && <fieldset className="editor-fields" disabled={submission.pending}>
      <label className="field-label">After this run<Select value={reviewBeforePublishing ? 'review' : 'configured'} onChange={event => setReviewBeforePublishing(event.target.value === 'review')}><option value="review">Finish at Ready for review, then schedule</option><option value="configured">Follow configured publishing steps</option></Select></label>
      {reviewBeforePublishing && <p className="dialog-note">All enabled steps run as mock preparation. Upload and Schedule steps prepare the handoff; you choose a publishing time after review.</p>}
      <label className="field-label">Step duration (milliseconds)<input className="text-input" type="number" min="1" max="3600000" step="1" value={duration} onChange={event => setDuration(event.target.value)} /></label>
      <label className="field-label">Simulated failure<Select value={failureStep} onChange={event => setFailureStep(event.target.value)}><option value="">No failure</option>{pipeline?.steps.filter(step => step.enabled).map(step => <option key={step.id} value={step.id}>{step.kind}</option>)}</Select></label>
      {!reviewBeforePublishing && pipeline?.steps.some(step => step.enabled && step.kind === 'Schedule') && <label className="field-label">Planned publishing time ({state.preferences?.timezone ?? 'UTC'})<input className="text-input" type="datetime-local" value={scheduledAt} onChange={event => setScheduledAt(event.target.value)} /></label>}
      <Button variant="primary" disabled={Boolean(blocker) || configurationErrors.length > 0} onClick={() => invoke(() => actions.startExecution(contentId, { reviewBeforePublishing, durationMs: Number(duration), failAtStepId: failureStep || null, scheduledAt, restart: Boolean(job) }))}>{job ? 'Start new mock run' : 'Run mock pipeline'}</Button>
    </fieldset>}
    <OperationFeedback result={submission.result} pending={submission.pending} />
  </section>
}
