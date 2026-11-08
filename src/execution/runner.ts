import type { AppState } from '../state/store'
import { nextExecutionDelay } from './engine.ts'

export interface RunnerHost {
  getState(): AppState
  tick(now: number): void
  now(): number
  schedule(callback: () => void, delay: number): unknown
  clear(handle: unknown): void
  delay?(state: AppState, now: number): number | null
}

/** Browser scheduling adapter. No offline catch-up and no external queue. */
export function createPipelineRunner(host: RunnerHost) {
  let timer: unknown = null
  let disposed = false
  const wake = () => {
    if (disposed) return
    if (timer !== null) host.clear(timer)
    timer = null
    const delay = (host.delay ?? nextExecutionDelay)(host.getState(), host.now())
    if (delay !== null) timer = host.schedule(() => {
      timer = null
      if (disposed) return
      host.tick(host.now())
      wake()
    }, delay)
  }
  return { wake, dispose: () => { disposed = true; if (timer !== null) host.clear(timer); timer = null } }
}
