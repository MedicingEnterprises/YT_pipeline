import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { RemoteStoreProvider } from './state/remote-store'
import { AuthProvider, useAuth } from './auth/AuthProvider'

function AccountWorkspace() { const { user } = useAuth(); return <RemoteStoreProvider key={user!.id}><App /></RemoteStoreProvider> }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider><AccountWorkspace /></AuthProvider>
  </StrictMode>,
)
