import { NavLink, useLocation } from 'react-router-dom'
import type { CSSProperties, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { outboxCount } from '@/lib/db'
import { syncOutbox } from '@/lib/sync/index'
import { retryStalledOutbox } from '@/lib/sync-store'
import { UniversalSearch } from './UniversalSearch'
import NotificationCenter from './NotificationCenter'
import { AIAssistant } from './AIAssistant'
import { Bot, UserCircle, Settings, LogOut, Sun, CloudLightning, Users } from 'lucide-react'
import { useSession } from '@/features/auth/session'
import AccountPanel from '@/features/auth/AccountPanel'

const MANAGER_NAV = [
  { to: '/', label: 'Home', icon: 'home' },
  { to: '/storm-os', label: 'Storm OS', icon: 'storm' },
  { to: '/team', label: 'Team', icon: 'users' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
] as const

const REP_NAV = [
  { to: '/', label: 'Home', icon: 'home' },
  { to: '/map', label: 'Map', icon: 'map' },
  { to: '/inspections', label: 'Jobs', icon: 'clipboard' },
] as const

function Icon({ name }: { name: string }) {
  const common = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  if (name === 'home') return <svg {...common} aria-hidden="true"><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></svg>
  if (name === 'clipboard') return <svg {...common} aria-hidden="true"><rect x="6" y="4" width="12" height="17" rx="2" /><path d="M9 4V3h6v1" /><path d="M9 10h6M9 14h6M9 18h3" /></svg>
  if (name === 'target') return <svg {...common} aria-hidden="true"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.2" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2" /></svg>
  if (name === 'map') return <svg {...common} aria-hidden="true"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" /><line x1="9" y1="3" x2="9" y2="18" /><line x1="15" y1="6" x2="15" y2="21" /></svg>
  if (name === 'storm') return <CloudLightning {...common} />
  if (name === 'users') return <Users {...common} />
  if (name === 'settings') return <Settings {...common} />
  return <svg {...common} aria-hidden="true"><line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="17" x2="20" y2="17" /></svg>
}

export function OnlinePill() {
  const { session, membership, membershipError } = useSession()
  const orgId = membership?.organizationId || null
  const userId = session?.user?.id || null
  const [online, setOnline] = useState(navigator.onLine)
  const [pending, setPending] = useState(0)
  const [isSyncing, setIsSyncing] = useState(false)

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    const tick = () => void outboxCount().then(setPending).catch(() => undefined)
    tick()
    const timer = window.setInterval(tick, 4000)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
      window.clearInterval(timer)
    }
  }, [])

  const handleSync = async () => {
    if (!online || pending === 0 || isSyncing || !orgId || !userId) return
    setIsSyncing(true)
    try {
      await retryStalledOutbox()
      await syncOutbox(orgId, userId)
      setPending(await outboxCount())
    } finally {
      setIsSyncing(false)
    }
  }

  const blocked = Boolean(membershipError) || (Boolean(session) && !membership)
  const label = !online ? 'Offline' : blocked ? 'Account' : isSyncing ? 'Syncing' : pending > 0 ? String(pending) + ' pending' : 'Synced'
  const tone = !online || blocked
    ? 'bg-warning-surface text-warning-highlight ring-warning-border'
    : pending > 0 || isSyncing
      ? 'bg-brand-primary/12 text-brand-hover ring-brand-primary/30'
      : 'bg-status-success/12 text-status-success ring-status-success/25'

  return (
    <button
      type="button"
      onClick={handleSync}
      disabled={!online || pending === 0 || isSyncing || !orgId || !userId}
      className={'inline-flex min-w-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11px] font-semibold ring-1 ' + tone}
      aria-label={label}
    >
      <span className="size-1.5 shrink-0 rounded-full bg-current" />
      <span className="max-w-[72px] truncate sm:max-w-none">{label}</span>
    </button>
  )
}

function ProfileMenu() {
  const [open, setOpen] = useState(false)
  const { session, membership, profile, signOut } = useSession()

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(!open)} className="grid size-10 place-items-center rounded-xl bg-bg-card text-text-secondary ring-1 ring-border-subtle" aria-label="Account">
        <UserCircle size={20} />
      </button>
      {open && (
        <>
          <button type="button" aria-label="Close account menu" className="fixed inset-0 z-40 cursor-default bg-transparent" onClick={() => setOpen(false)} />
          <div className="fixed inset-x-3 top-[calc(env(safe-area-inset-top)+4.5rem)] z-50 overflow-hidden rounded-2xl border border-border-subtle bg-bg-card shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-72">
            <div className="border-b border-border-subtle bg-bg-page px-4 py-3">
              <p className="truncate text-sm font-semibold text-text-primary">{profile?.fullName || session?.user.email || 'Not signed in'}</p>
              {membership && <p className="mt-1 truncate text-xs text-text-secondary">{membership.organizationName} · {membership.role}</p>}
            </div>
            <div className="p-2">
              <NavLink to="/settings" onClick={() => setOpen(false)} className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm text-text-primary hover:bg-bg-elevated">
                <Settings size={17} className="text-text-secondary" /> Settings & Integrations
              </NavLink>
              {session ? (
                <button type="button" onClick={() => { setOpen(false); void signOut() }} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-sm text-status-critical hover:bg-bg-elevated">
                  <LogOut size={17} /> Sign Out
                </button>
              ) : <div className="pt-2"><AccountPanel /></div>}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function useMeasuredHeight(active: boolean) {
  const ref = useRef<HTMLElement | null>(null)
  const [height, setHeight] = useState(0)
  useEffect(() => {
    if (!active) { setHeight(0); return }
    const element = ref.current
    if (!element) return
    const measure = () => setHeight(Math.ceil(element.getBoundingClientRect().height))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [active])
  return { ref, height }
}

export default function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const immersive = pathname.startsWith('/inspection/') || pathname.startsWith('/evidence/')
  const edgeToEdge = pathname === '/map' || pathname === '/mission'
  const { ref: navRef, height: navHeight } = useMeasuredHeight(!immersive)
  const { ref: headerRef, height: headerHeight } = useMeasuredHeight(!pathname.startsWith('/evidence/'))
  const [assistantOpen, setAssistantOpen] = useState(false)
  const { membership } = useSession()

  const role = membership?.role?.toLowerCase() || 'rep'
  const isManager = role === 'admin' || role === 'manager'
  const navItems = isManager ? MANAGER_NAV : REP_NAV

  return (
    <div
      className="app-shell min-h-dvh w-full"
      style={{
        '--bottom-nav-height': navHeight + 'px',
        '--app-header-height': headerHeight + 'px',
      } as CSSProperties}
    >
      {!pathname.startsWith('/evidence/') && (
        <header ref={headerRef} className="sticky top-0 z-30 border-b border-border-subtle/80 bg-bg-app/95 backdrop-blur-xl">
          <div className="mx-auto flex min-h-14 w-full max-w-6xl items-center gap-2 px-3 sm:px-4">
            <NavLink to="/" className="flex min-w-0 items-center gap-2.5 rounded-xl py-1 pr-1">
              <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-primary font-display text-sm font-bold text-white">DR</div>
              <div className="hidden min-w-0 sm:block">
                <div className="truncate font-display text-[15px] leading-none tracking-wide">Delta Ridge</div>
                <div className="mt-1 text-[9px] font-semibold uppercase tracking-[0.2em] text-text-muted">Field OS</div>
              </div>
            </NavLink>

            <div className="ml-auto flex min-w-0 items-center gap-1.5 sm:gap-2">
              <OnlinePill />
              <div className="hidden sm:block"><UniversalSearch /></div>
              <div className="hidden sm:block"><NotificationCenter /></div>
              <button type="button" onClick={() => setAssistantOpen(true)} className="hidden size-10 place-items-center rounded-xl text-text-secondary hover:bg-bg-elevated sm:grid" aria-label="Open AI assistant">
                <Bot size={19} />
              </button>
              <button type="button" onClick={() => document.body.classList.toggle('theme-sunglare')} className="hidden size-10 place-items-center rounded-xl text-text-secondary hover:bg-bg-elevated md:grid" aria-label="Toggle sun glare mode">
                <Sun size={18} />
              </button>
              <ProfileMenu />
            </div>
          </div>
        </header>
      )}

      <main
        className={edgeToEdge ? 'app-main app-main--edge' : 'app-main'}
        style={{
          paddingBottom: immersive
            ? 'max(1rem, env(safe-area-inset-bottom))'
            : 'calc(var(--bottom-nav-height, 0px) + max(12px, env(safe-area-inset-bottom)))',
        }}
      >
        <div className={edgeToEdge ? 'w-full' : 'mx-auto w-full max-w-6xl px-3 py-4 sm:px-4 sm:py-5'}>
          {children}
        </div>
      </main>

      {!immersive && (
        <nav ref={navRef} className="mobile-tabbar fixed inset-x-0 bottom-0 z-40 border-t border-border-subtle/80 bg-bg-app/95 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl">
          <div className="mx-auto grid max-w-screen-sm" style={{ gridTemplateColumns: `repeat(${navItems.length}, minmax(0, 1fr))` }}>
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  'relative mx-0.5 my-1 flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 text-[10px] font-semibold transition-colors ' +
                  (isActive ? 'text-brand-hover' : 'text-text-muted active:bg-bg-elevated')
                }
              >
                {({ isActive }) => (
                  <>
                    <span className={'grid size-8 place-items-center rounded-xl ' + (isActive ? 'bg-brand-primary/14' : '')}><Icon name={item.icon} /></span>
                    <span className="truncate">{item.label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </nav>
      )}

      <AIAssistant isOpen={assistantOpen} onClose={() => setAssistantOpen(false)} />
    </div>
  )
}
