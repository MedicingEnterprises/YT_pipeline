import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  BarChart3,
  Bell,
  CalendarDays,
  ChevronDown,
  CircleHelp,
  Clapperboard,
  LayoutDashboard,
  Menu,
  Radio,
  Search,
  Settings2,
  Sparkles,
  Workflow,
  X,
  Video,
  Plus,
} from 'lucide-react'
import { Avatar, Button } from './ui'
import { useStore } from '../state/store'
import { ChannelEditor, ContentEditor } from './EntityEditors'
import { WorkspaceFeedback, WorkspaceErrorBoundary, useDialog } from './feedback'
import { workspaceCounts } from '../state/selectors'
import { useOptionalAuth } from '../auth/AuthProvider'
import { WorkspaceImport } from './WorkspaceImport'

const primaryLinks = [
  { label: 'Dashboard', to: '/', icon: LayoutDashboard },
  { label: 'Channels', to: '/channels', icon: Radio },
  { label: 'AI Providers', to: '/providers', icon: Sparkles },
  { label: 'Pipelines', to: '/pipelines', icon: Workflow },
]

const contentLinks = [
  { label: 'Content', to: '/content', icon: Clapperboard },
  { label: 'Scheduler', to: '/scheduler', icon: CalendarDays },
  { label: 'Analytics', to: '/analytics', icon: BarChart3 },
]

const pageTitles: Record<string, string> = {
  '/': 'Dashboard',
  '/channels': 'Channels',
  '/providers': 'AI Providers',
  '/pipelines': 'Pipelines',
  '/content': 'Content',
  '/scheduler': 'Scheduler',
  '/analytics': 'Analytics',
  '/settings': 'Settings',
}

function NavigationLinks({ onNavigate }: { onNavigate: () => void }) {
  const { state } = useStore()
  return (
    <>
      <p className="nav-label">Workspace</p>
      <nav className="nav-list" aria-label="Workspace">
        {primaryLinks.map(({ label, to, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            onClick={onNavigate}
            className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
          >
            <Icon size={18} strokeWidth={1.8} />
            <span>{label}</span>
            {label === 'Pipelines' && <span className="nav-count">{state.pipelines.size}</span>}
          </NavLink>
        ))}
      </nav>
      <p className="nav-label nav-label-spaced">Manage</p>
      <nav className="nav-list" aria-label="Manage">
        {contentLinks.map(({ label, to, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={onNavigate}
            className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
          >
            <Icon size={18} strokeWidth={1.8} />
            <span>{label}</span>
            {label === 'Content' && <span className="nav-count">{state.content.size}</span>}
          </NavLink>
        ))}
      </nav>
    </>
  )
}

function Sidebar({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const { state } = useStore()
  const [isMobile, setIsMobile] = useState(false)
  const auth = useOptionalAuth()
  const [accountError, setAccountError] = useState('')
  useEffect(() => { const media = window.matchMedia('(max-width: 920px)'); const update = () => setIsMobile(media.matches); update(); media.addEventListener('change', update); return () => media.removeEventListener('change', update) }, [])
  const ref = useDialog(onClose, false, isMobile && open)
  return (
    <>
      {open && <button className="sidebar-overlay" onClick={onClose} aria-label="Close menu" />}
      <aside id="workspace-sidebar" ref={ref} className={`sidebar${open ? ' sidebar-open' : ''}`} inert={isMobile && !open} role={isMobile && open ? 'dialog' : undefined} aria-modal={isMobile && open ? true : undefined} aria-label={isMobile && open ? 'Workspace navigation' : undefined}>
        <div className="brand">
          <NavLink to="/" className="brand-link" onClick={onClose}>
            <span className="brand-mark">
              <span />
              <span />
              <span />
            </span>
            <span className="brand-wordmark">content<span>hub</span></span>
          </NavLink>
          <button className="mobile-close" onClick={(event) => { event.preventDefault(); onClose() }} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>

        <button className="workspace-switcher" disabled title="One local workspace. Workspace switching is unavailable in this prototype.">
          <span className="workspace-avatar">N</span>
          <span className="workspace-details">
            <span className="workspace-caption">Workspace</span>
            <span className="workspace-name">{state.preferences?.workspaceName}</span>
          </span>
          <ChevronDown size={15} className="workspace-chevron" />
        </button>

        <div className="sidebar-navigation">
          <NavigationLinks onNavigate={onClose} />
        </div>

        <div className="sidebar-bottom">
          <div className="plan-card">
            <div className="plan-card-icon"><Sparkles size={15} /></div>
            <strong>Your creative space</strong>
            <p>Bring your channel ideas together in one place.</p>
            <div className="plan-progress"><span /></div>
            <small>{Array.from(state.channels.values()).filter(channel => channel.status === 'connected').length} of {state.channels.size} channels connected</small>
          </div>
          <NavLink
            to="/settings"
            onClick={onClose}
            className={({ isActive }) => `nav-link settings-link${isActive ? ' active' : ''}`}
          >
            <Settings2 size={18} strokeWidth={1.8} />
            <span>Settings</span>
          </NavLink>
          <div className="user-profile">
            <Avatar initials={auth?.user?.displayName.slice(0, 2).toUpperCase() ?? 'JD'} />
            <span className="user-details"><strong>{auth?.user?.displayName ?? 'Jordan Davis'}</strong><small>{auth?.user?.email ?? 'Creator plan'}</small>{accountError && <small role="alert">{accountError}</small>}</span>
            <button className="profile-more" aria-label={auth ? 'Sign out' : 'Profile options unavailable'} disabled={!auth} title={auth ? 'Sign out' : 'Account unavailable'} onClick={() => void auth?.logout().catch(error => setAccountError(error.message))}><MoreIcon /></button>
          </div>
        </div>
      </aside>
    </>
  )
}

function MoreIcon() {
  return <span className="more-dots" aria-hidden="true">···</span>
}

export function AppShell({
  children,
  dialogKind,
  onOpenDialog,
  onCloseDialog,
}: {
  children: ReactNode
  dialogKind: 'video' | 'channel' | 'pipeline' | null
  onOpenDialog: () => void
  onCloseDialog: () => void
}) {
  const { state, persistenceStatus, remote, reload } = useStore()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const helpRef = useDialog(() => setHelpOpen(false), false, helpOpen)
  const location = useLocation()
  const navigate = useNavigate()
  const title = pageTitles[location.pathname] ?? 'Dashboard'
  const searchRef = useRef<HTMLInputElement>(null)
  const openContentSearch = useCallback(() => { const input = document.querySelector<HTMLInputElement>('[aria-label="Search content"]'); if (input?.getClientRects().length) input.focus(); else navigate('/content?focus=search') }, [navigate])
  const counts = workspaceCounts(state)
  const footerStatus = persistenceStatus && !['saved', 'first-run'].includes(persistenceStatus.kind) ? 'Workspace not saved' : counts.failed ? `${counts.failed} jobs need attention` : counts.processing ? `${counts.processing} mock jobs running` : 'Mock workspace ready'

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        if (document.querySelector('[aria-modal="true"]')) return
        event.preventDefault()
        if (searchRef.current?.getClientRects().length) searchRef.current.focus()
        else openContentSearch()
      }
    }
    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [openContentSearch])


  useEffect(() => {
    const root = document.documentElement
    root.dataset.compact = String(state.preferences?.compactDensity ?? false)
    root.dataset.reducedMotion = String(state.preferences?.reducedMotion ?? false)
    root.lang = state.preferences?.language ?? 'en-US'
    root.dataset.theme = state.preferences?.appearance ?? 'light'
  }, [state.preferences])

  return (
    <div className="app-shell">
      <Sidebar open={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} />
      <div className="app-main">
        <header className="topbar">
          <div className="topbar-left">
            <Button
              className="mobile-menu-button"
              variant="ghost"
              iconOnly
              icon={<Menu size={20} />}
              aria-label="Open navigation"
              aria-expanded={mobileMenuOpen}
              aria-controls="workspace-sidebar"
              onClick={() => setMobileMenuOpen(true)}
            />
            <div className="breadcrumbs"><span>Workspace</span><span className="breadcrumb-slash">/</span><strong>{title}</strong></div>
          </div>
          <div className="topbar-actions">
            <label className="search-box">
              <button type="button" className="search-trigger" aria-label="Open content search" onClick={openContentSearch}><Search size={17} /></button>
              <input ref={searchRef} aria-label="Search content workspace" placeholder="Search content..." onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); navigate(`/content?search=${encodeURIComponent(event.currentTarget.value.trim())}`) } }} />
              <kbd>Ctrl K</kbd>
            </label>
            <Button
              variant="ghost"
              iconOnly
              icon={<span className="notification-icon"><Bell size={18} />{state.activities.length > 0 && <span className="notification-dot" />}</span>}
              aria-label="Notifications"
              className="notification-button"
              onClick={() => navigate('/?activity=all#activity-history')}
            >
            </Button>
            <span className="topbar-divider" />
            <button className="help-link" onClick={() => setHelpOpen(true)}><CircleHelp size={17} /><span>Help</span></button>
            <Button variant="primary" className="topbar-create" icon={<Plus size={16} />} onClick={onOpenDialog}>New video</Button>
          </div>
        </header>
        <main className="page-content"><WorkspaceFeedback />{remote && reload && <WorkspaceImport onImported={reload} />}<WorkspaceErrorBoundary key={location.pathname}>{children}</WorkspaceErrorBoundary></main>
        <footer className="app-footer">
          <span><Video size={15} /> Content Hub <span className="footer-divider">·</span> Creator workspace</span>
          <span className="footer-status"><span />{footerStatus}</span>
        </footer>
      </div>
      {dialogKind === 'video' && <ContentEditor onClose={onCloseDialog} onSaved={id => navigate(`/content?content=${encodeURIComponent(id)}`)} />}
      {dialogKind === 'channel' && <ChannelEditor onClose={onCloseDialog} />}
      {helpOpen && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setHelpOpen(false) }}><section ref={helpRef} className="dialog" tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="workspace-help-title"><div className="dialog-header"><h2 id="workspace-help-title">Mock workspace help</h2><Button onClick={() => setHelpOpen(false)}>Close help</Button></div><ol><li>Create and mock-connect a channel.</li><li>Configure mock providers and assign compatible providers to pipeline steps.</li><li>Create an idea, choose its channel and pipeline, and run preparation from Content Details.</li><li>Pause, resume, or retry as needed. Review Ready content, then schedule a future publication.</li><li>Keep the app open for the mock queue to publish. Open Notifications to review activity history.</li></ol><p>Workspace changes are local to this browser. No AI generation, uploads, authentication, or closed-browser background work occurs.</p></section></div>}
    </div>
  )
}
