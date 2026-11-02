import { useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
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
import { WorkspaceFeedback, WorkspaceErrorBoundary } from './feedback'

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
  return (
    <>
      {open && <button className="sidebar-overlay" onClick={onClose} aria-label="Close menu" />}
      <aside className={`sidebar${open ? ' sidebar-open' : ''}`}>
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

        <button className="workspace-switcher">
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
            <Avatar initials="JD" />
            <span className="user-details"><strong>Jordan Davis</strong><small>Creator plan</small></span>
            <button className="profile-more" aria-label="Profile options"><MoreIcon /></button>
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
  const { state } = useStore()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const location = useLocation()
  const title = pageTitles[location.pathname] ?? 'Dashboard'
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [])


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
              onClick={() => setMobileMenuOpen(true)}
            />
            <div className="breadcrumbs"><span>Workspace</span><span className="breadcrumb-slash">/</span><strong>{title}</strong></div>
          </div>
          <div className="topbar-actions">
            <label className="search-box">
              <Search size={17} />
              <input ref={searchRef} aria-label="Search" placeholder="Search anything..." />
              <kbd>Ctrl K</kbd>
            </label>
            <Button
              variant="ghost"
              iconOnly
              icon={<span className="notification-icon"><Bell size={18} /><span className="notification-dot" /></span>}
              aria-label="Notifications"
              className="notification-button"
            >
            </Button>
            <span className="topbar-divider" />
            <button className="help-link"><CircleHelp size={17} /><span>Help</span></button>
            <Button variant="primary" className="topbar-create" icon={<Plus size={16} />} onClick={onOpenDialog}>New video</Button>
          </div>
        </header>
        <main className="page-content"><WorkspaceFeedback /><WorkspaceErrorBoundary key={location.pathname}>{children}</WorkspaceErrorBoundary></main>
        <footer className="app-footer">
          <span><Video size={15} /> Content Hub <span className="footer-divider">·</span> Creator workspace</span>
          <span className="footer-status"><span /> All systems ready</span>
        </footer>
      </div>
      {dialogKind === 'video' && <ContentEditor onClose={onCloseDialog} />}
      {dialogKind === 'channel' && <ChannelEditor onClose={onCloseDialog} />}
    </div>
  )
}
