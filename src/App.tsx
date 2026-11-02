import { useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import {
  AnalyticsPage,
  ChannelsPage,
  ContentPage,
  DashboardPage,
  ProvidersPage,
  SchedulerPage,
  SettingsPage,
  WorkflowsPage,
} from './pages'
import './App.css'

type DialogKind = 'video' | 'channel' | 'pipeline'

function RoutedApp() {
  const [dialogKind, setDialogKind] = useState<DialogKind | null>(null)
  const openDialog = (kind: DialogKind) => setDialogKind(kind)

  return (
    <AppShell
      dialogKind={dialogKind}
      onOpenDialog={() => openDialog('video')}
      onCloseDialog={() => setDialogKind(null)}
    >
      <Routes>
        <Route path="/" element={<DashboardPage onCreate={() => openDialog('video')} />} />
        <Route path="/channels" element={<ChannelsPage />} />
        <Route path="/providers" element={<ProvidersPage />} />
        <Route path="/pipelines" element={<WorkflowsPage />} />
        <Route path="/content" element={<ContentPage />} />
        <Route path="/scheduler" element={<SchedulerPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <RoutedApp />
    </BrowserRouter>
  )
}
