import type { AppState } from '../state/store'
import type { WorkspaceSession } from '../state/persistence'
import { tickJobQueue } from './queue.ts'

/** Pure mock results become visible only after the automatic checkpoint saves. */
export function advanceDurableQueue(state: AppState, now: number, session: WorkspaceSession | null) {
  if (session) {
    const status = session.verify()
    if (status.kind !== 'saved') return { state, status }
  }
  const next = tickJobQueue(state, now)
  const status = session && next !== state ? session.save(next) : session?.status ?? null
  return { state: status && status.kind !== 'saved' ? state : next, status }
}

/** Optional native Web Lock serializes ticks across tabs. The run callback reads
 * current state after acquiring the lock; disposed callbacks never execute. */
export function createQueueDispatcher(host: { run(): void; settled(): void; error?: (error: unknown) => void; lock?: (work: () => void) => Promise<unknown> }) {
  let busy = false
  let disposed = false
  let failed = false
  const report = (error: unknown) => { failed = true; if (!disposed) { try { host.error?.(error) } catch { /* Error reporting must not leak an asynchronous rejection. */ } } }
  const tick = () => {
    if (busy || disposed || failed) return
    busy = true
    let executed = false
    const work = () => { if (!disposed) { executed = true; try { host.run() } catch (error) { report(error) } } }
    const finish = () => { busy = false; if (!disposed && executed && !failed) { try { host.settled() } catch (error) { report(error) } } }
    if (host.lock) {
      // Restricted browser contexts may expose Web Locks but deny requests.
      // The durable snapshot guard still applies when the native lock is absent.
      const fallback = () => { if (!executed) work() }
      try { void host.lock(work).catch(fallback).finally(finish) }
      catch { try { fallback() } finally { finish() } }
    }
    else { try { work() } finally { finish() } }
  }
  return { tick, get busy() { return busy }, get failed() { return failed }, dispose: () => { disposed = true } }
}
