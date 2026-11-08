import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { ApiError, createApiClient, type ApiClient } from '../api/client'
import { Button, Card } from '../components/ui'

export interface UserProfile { id: string; email: string; displayName: string }
interface AuthContextValue { api: ApiClient; user: UserProfile | null; logout: () => Promise<void> }
const AuthContext = createContext<AuthContextValue | null>(null)
export function useOptionalAuth() { return useContext(AuthContext) }
export function useAuth() { const value = useContext(AuthContext); if (!value) throw Error('Authentication context unavailable'); return value }
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null)
  const [restoring, setRestoring] = useState(true)
  const [error, setError] = useState('')
  const [register, setRegister] = useState(false)
  const [busy, setBusy] = useState(false)
  const locked = useRef(false)
  const currentAccount = useRef(false)
  const [api] = useState(() => createApiClient({ baseUrl: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001', unauthorized: () => { if (currentAccount.current) setError('Your session expired or ended. Sign in again.'); currentAccount.current = false; setUser(null); setRestoring(false) } }))
  const restore = useCallback(async (signal?: AbortSignal) => {
    setRestoring(true); setError('')
    try { const result = await api.request<{ data: UserProfile }>('/api/v1/auth/me', 'GET', undefined, signal); if (!signal?.aborted) { currentAccount.current = true; setUser(result.data) } }
    catch (error) { if (!signal?.aborted && (!(error instanceof ApiError) || error.status !== 401)) setError(error instanceof Error ? error.message : 'Could not restore the session.') }
    finally { if (!signal?.aborted) setRestoring(false) }
  }, [api])
  useEffect(() => { const controller = new AbortController(); void restore(controller.signal); return () => controller.abort() }, [restore])
  const logout = async () => {
    if (locked.current) return
    locked.current = true
    try { await api.request('/api/v1/auth/logout', 'POST'); api.invalidateCsrf(); currentAccount.current = false; setUser(null); setError('') }
    finally { locked.current = false }
  }
  return <AuthContext.Provider value={{ api, user, logout }}>{user ? children : <main className="auth-screen"><Card><h1>{restoring ? 'Restoring your session' : register ? 'Create your account' : 'Sign in to Content Hub'}</h1>{restoring ? <p role="status">Connecting to the backend…</p> : <form onSubmit={async event => {
    event.preventDefault(); if (locked.current) return; locked.current = true; setBusy(true); setError('')
    const form = event.currentTarget; const values = new FormData(form)
    try {
      const payload = { email: String(values.get('email')), password: String(values.get('password')), ...(register ? { displayName: String(values.get('displayName')) } : {}) }
      const result = await api.request<{ data: { user: UserProfile } }>(`/api/v1/auth/${register ? 'register' : 'login'}`, 'POST', payload)
      api.invalidateCsrf(); form.reset(); currentAccount.current = true; setUser(result.data.user)
    } catch (error) { setError(error instanceof Error ? error.message : 'Sign-in failed.') }
    finally { locked.current = false; setBusy(false) }
  }}><fieldset className="editor-fields" disabled={busy}>{register && <label className="field-label">Name<input className="text-input" name="displayName" autoComplete="name" required maxLength={120} /></label>}<label className="field-label">Email<input className="text-input" type="email" name="email" autoComplete="username" required maxLength={254} /></label><label className="field-label">Password<input className="text-input" type="password" name="password" autoComplete={register ? 'new-password' : 'current-password'} required minLength={register ? 15 : 1} maxLength={128} /></label>{register && <p>Use at least 15 characters.</p>}<Button type="submit" variant="primary">{busy ? 'Connecting…' : register ? 'Register' : 'Sign in'}</Button><Button type="button" onClick={() => { setRegister(value => !value); setError('') }}>{register ? 'Already have an account? Sign in' : 'Create an account'}</Button><Button type="button" onClick={() => void restore()}>Retry session restoration</Button></fieldset></form>}{error && <p role="alert">{error}</p>}</Card></main>}</AuthContext.Provider>
}
