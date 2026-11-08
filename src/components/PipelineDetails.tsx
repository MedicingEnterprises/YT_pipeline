import { Link } from 'react-router-dom'
import { useStore } from '../state/store'
import { pipelineJobs } from '../state/selectors'
import { Button } from './ui'
import { useDialog } from './feedback'
import { JobQueuePanel } from './JobQueue'

export function PipelineDetailsDialog({ pipelineId, onClose }: { pipelineId: string; onClose: () => void }) {
  const { state } = useStore()
  const ref = useDialog(onClose, false)
  const pipeline = state.pipelines.get(pipelineId)
  const jobs = pipelineJobs(state, pipelineId)
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><section ref={ref} tabIndex={-1} className="dialog content-dialog" role="dialog" aria-modal="true" aria-labelledby="pipeline-details-title">
    <div className="dialog-header"><h2 id="pipeline-details-title">{pipeline?.name ?? 'Pipeline unavailable'}</h2><Button onClick={onClose}>Close details</Button></div>
    {pipeline ? <>
      <p>{pipeline.description}</p><p>{pipeline.enabled ? 'Enabled' : 'Disabled'} · {jobs.filter(job => ['pending', 'running'].includes(job.status)).length} active jobs · {jobs.filter(job => job.status === 'failed').length} failed jobs</p>
      <p>Channels: {pipeline.assignedChannelIds.map(id => state.channels.get(id)?.name ?? 'Unavailable channel').join(', ') || 'Any channel'}</p>
      <ol>{pipeline.steps.map(step => <li key={step.id}><details><summary>{step.kind} · {step.enabled ? 'Enabled' : 'Disabled'}</summary><p>Provider: {step.config.providerId ? state.providers.get(step.config.providerId)?.name ?? 'Unavailable provider' : 'Built-in mock simulation'}</p><p>{step.config.instructions || 'No extra instructions.'}</p></details></li>)}</ol>
      <Link to="/content">Choose content to run this pipeline</Link>
      <JobQueuePanel pipelineId={pipelineId} />
    </> : <p>This pipeline was deleted. Its retained execution history is available in the Scheduler queue.</p>}
  </section></div>
}
