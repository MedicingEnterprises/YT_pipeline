import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../state/store'
import { queueStatusLabel } from '../execution/queue'
import { Button, Card } from './ui'
import { OperationFeedback, useSubmission } from './feedback'

export function JobQueuePanel({ contentId, pipelineId, compact = false }: { contentId?: string; pipelineId?: string; compact?: boolean }) {
  const { state, actions, remote } = useStore()
  const submission = useSubmission()
  const [showAll, setShowAll] = useState(false)
  const jobs = [...state.jobs.values()].filter(job => job.queue && (!contentId || job.contentId === contentId) && (!pipelineId || (job.execution?.pipelineId ?? job.queue.pipelineId) === pipelineId)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
  const invoke = (work: () => ReturnType<typeof actions.cancelQueueJob>) => { void submission.submit(work) }
  const counts = `${jobs.filter(job => job.status === 'pending' && !(job.execution?.paused ?? job.paused)).length} queued · ${jobs.filter(job => job.status === 'running' && !(job.execution?.paused ?? job.paused)).length} processing · ${jobs.filter(job => job.execution?.paused ?? job.paused).length} paused · ${jobs.filter(job => job.status === 'failed').length} failed`
  return <Card className="page-section job-queue" >
    <h2>Mock job queue</h2><p role="status">{counts}</p>
    <p className="dialog-note">{remote ? `Jobs and history are stored on the backend and refreshed while this app is visible. No backend execution worker is connected yet. Planned times display in ${state.preferences?.timezone ?? 'UTC'}.` : `Checks due jobs about once per second while this app is open. Nothing executes while the browser is closed. Planned times use ${state.preferences?.timezone ?? 'UTC'}. Automatic jobs stop if browser storage cannot save their checkpoints.`}</p>
    {compact ? <Link to="/scheduler">Open queue and execution history</Link> : <>
      <OperationFeedback result={submission.result} pending={submission.pending} />
      {!jobs.length && <p>No queued jobs or execution history yet.</p>}
      {(showAll ? jobs : jobs.slice(0, 10)).map(job => <section className="page-section" key={job.id} aria-label={`Job ${job.id}`}>
        <Link to={`/content?content=${encodeURIComponent(job.contentId)}`}>{state.content.get(job.contentId)?.title ?? 'Unavailable content'}</Link>
        <p>{job.queue!.type} · {queueStatusLabel[job.status]}{job.execution?.paused ? ' · Paused' : ''} · Attempt {job.queue!.attempt}{job.execution ? ` · ${job.execution.progress}%` : ''}</p>
        <small>{job.id}{job.queue!.scheduledAt && ` · Planned ${job.queue!.scheduledAt.replace('T', ' ')} (${job.queue!.timezone})`}</small>
        {job.errorMessage && <p role="alert">{job.errorMessage}</p>}
        <div className="dialog-footer">
          {(job.execution || remote) && ['pending', 'running'].includes(job.status) && <Button disabled={submission.pending} onClick={() => invoke(() => (job.execution?.paused ?? job.paused) ? actions.resumeExecution(job.id) : actions.pauseExecution(job.id))}>{(job.execution?.paused ?? job.paused) ? 'Resume execution' : 'Pause execution'}</Button>}
          {['pending', 'running', 'failed'].includes(job.status) && <Button disabled={submission.pending} onClick={() => invoke(() => actions.cancelQueueJob(job.id))}>Cancel job</Button>}
          {job.status === 'failed' && <Button disabled={submission.pending} onClick={() => invoke(() => actions.retryQueueJob(job.id))}>Retry job</Button>}
        </div>
        <details><summary>Execution history ({job.queue!.history.length})</summary><ol>{job.queue!.history.map((event, index) => <li key={index}>{event.at} · {queueStatusLabel[event.status]} · Attempt {event.attempt} · {event.message}</li>)}</ol></details>
      </section>)}
      {jobs.length > 10 && <Button onClick={() => setShowAll(value => !value)}>{showAll ? 'Show recent jobs' : 'Show all jobs'}</Button>}
    </>}
  </Card>
}
