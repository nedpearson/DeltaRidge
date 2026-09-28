import { NavLink, useLocation } from 'react-router-dom'
import type { CSSProperties, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { outboxCount } from '@/lib/db'
import { syncOutbox } from '@/lib/sync/index'
import { UniversalSearch } from './UniversalSearch'
import NotificationCenter from './NotificationCenter'
import { AIAssistant } from './AIAssistant'
import { Bot } from 'lucide-react'

export const NAV = [
  { to: '/', label: 'Today', icon: 'home' },
  { to: '/leads', label: 'Leads', icon: 'target' },
  { to: '/map', label: 'Map', icon: 'map' },
  { to: '/inspections', label: 'Jobs', icon: 'clipboard' },
    { to: '/more', label: 'More', icon: 'menu' },
  { to: '/settings', label: 'Settings', icon: 'tag' },
] as const

function Icon({ name }: { name: string }) {
  const common = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  if (name === 'home') return <svg {...common} aria-hidden="true"><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></svg>
  if (name === 'clipboard') return <svg {...common} aria-hidden="true"><rect x="6" y="4" width="12" height="17" rx="2" /><path d="M9 4V3h6v1" /><path d="M9 10h6M9 14h6M9 18h3" /></svg>
  if (name === 'target') return <svg {...common} aria-hidden="true"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.2" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2" /></svg>
  if (name === 'tag') return <svg {...common} aria-hidden="true"><path d="M3 12.5V4a1 1 0 0 1 1-1h8.5L21 11.5 12.5 20z" /><circle cx="7.5" cy="7.5" r="1.4" /></svg>
  if (name === 'map') return <svg {...common} aria-hidden="true"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" /><line x1="9" y1="3" x2="9" y2="18" /><line x1="15" y1="6" x2="15" y2="21" /></svg>
  if (name === 'message') return <svg {...common} aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
  if (name === 'menu') return <svg {...common} aria-hidden="true"><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
  return <svg {...common} aria-hidden="true"><path d="M3 8h3.5L8 6h8l1.5 2H21v11H3z" /><circle cx="12" cy="13.5" r="3.5" /></svg>
}

export function OnlinePill() {
  const [online, setOnline] = useState(navigator.onLine)
  const [pending, setPending] = useState(0)

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

  const label = !online ? 'Offline — saved on device' : pending > 0 ? `${pending} waiting to sync` : 'Saved on device'
  const [isSyncing, setIsSyncing] = useState(false)

  const handleSync = async () => {
    if (!online || pending === 0 || isSyncing) return
    setIsSyncing(true)
    if ('vibrate' in navigator) navigator.vibrate(20)
    try {
      await syncOutbox(null, null)
      const newCount = await outboxCount()
      setPending(newCount)
      if (newCount === 0 && 'vibrate' in navigator) navigator.vibrate([20, 50, 20])
    } catch {
      console.warn('Manual sync failed')
    } finally {
      setIsSyncing(false)
    }
  }

  const tone = !online ? 'bg-warning-surface/15 text-warning-highlight ring-warning-border' : isSyncing ? 'bg-brand-primary/15 text-brand-400 ring-brand-400/30' : 'bg-status-success/15 text-status-success ring-emerald-300/30'
  const finalLabel = isSyncing ? 'Syncing...' : label

  return (
    <button 
      onClick={handleSync}
      disabled={!online || pending === 0 || isSyncing}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 transition-all ${tone} ${pending > 0 && online ? 'hover:bg-opacity-20 cursor-pointer active:scale-95' : 'cursor-default'}`}
    >
      <span className={`size-1.5 rounded-full bg-current ${isSyncing ? 'animate-ping' : ''}`} />
      {finalLabel}
    </button>
  )
}

function useNavHeight(active: boolean) {
  const ref = useRef<HTMLElement | null>(null)
  const [height, setHeight] = useState(0)

  useEffect(() => {
    if (!active) {
      setHeight(0)
      return
    }
    const element = ref.current
    if (element === null) return

    const measure = () => setHeight(element.getBoundingClientRect().height)
    measure()

    const observer = new ResizeObserver(measure)
    observer.observe(element)
    window.addEventListener('orientationchange', measure)
    window.addEventListener('resize', measure)

    let cancelled = false
    void document.fonts?.ready.then(() => {
      if (!cancelled) measure()
    })

    return () => {
      cancelled = true
      observer.disconnect()
      window.removeEventListener('orientationchange', measure)
      window.removeEventListener('resize', measure)
    }
  }, [active])

  return { ref, height }
}

export default function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const hideNav = pathname.startsWith('/inspection/') || pathname.startsWith('/evidence/')
  const { ref: navRef, height: navHeight } = useNavHeight(!hideNav)
  const [isAIAssistantOpen, setIsAIAssistantOpen] = useState(false)

  return (
    <div
      className="mx-auto flex min-h-dvh w-full max-w-screen-sm flex-col md:max-w-3xl lg:max-w-5xl"
      style={{ '--bottom-nav-height': `${navHeight}px` } as CSSProperties}
    >
      {!pathname.startsWith('/evidence/') && (<header className="sticky top-0 z-20 border-b border-border-subtle bg-brand-pressed text-text-primary shadow-lg shadow-brand-950/10">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="grid size-9 place-items-center rounded-lg bg-brand-primary font-display text-sm font-bold text-text-primary shadow-md shadow-black/20 ring-1 ring-white/20">DR</div>
            <div className="leading-none">
              <div className="font-display text-[15px] tracking-wide text-text-primary">Delta Ridge</div>
              <div className="mt-0.5 text-[10px] uppercase tracking-widest text-text-secondary">Field</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setIsAIAssistantOpen(true)} className="flex items-center gap-1.5 rounded-full bg-brand-primary/10 px-3 py-1.5 text-sm font-medium text-brand-400 hover:bg-brand-primary/20">
              <Bot size={16} />
              <span className="hidden sm:inline">AI</span>
            </button>
            <button onClick={() => document.body.classList.toggle('theme-sunglare')} className="flex items-center gap-1.5 rounded-full bg-warning-surface px-3 py-1.5 text-sm font-medium text-warning-highlight hover:bg-warning-surface/80" title="Sun Glare Mode">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
            </button>
            <UniversalSearch />
            <NotificationCenter />
            <OnlinePill />
          </div>
        </div>
      </header>)}

      <main
        className="flex-1 px-4 pt-4"
        style={{
          paddingBottom: hideNav
            ? '1.5rem'
            : 'calc(var(--bottom-nav-height, 0px) + env(safe-area-inset-bottom, 0px) + 1rem)',
        }}
      >
        {children}
      </main>

      {!hideNav && (
        <nav
          ref={navRef}
          className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-screen-sm border-t border-border-subtle bg-brand-pressed px-2 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_rgba(8,21,46,0.18)] md:max-w-3xl lg:max-w-5xl"
        >
          <div
            className="grid"
            style={{ gridTemplateColumns: `repeat(${NAV.length}, minmax(0, 1fr))` }}
          >
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `mx-1 my-1 flex flex-col items-center gap-1 rounded-xl py-2 text-[11px] font-semibold transition-colors ${
                    isActive ? 'bg-bg-card/10 text-brand-300' : 'text-text-secondary hover:bg-bg-card/5 hover:text-text-primary'
                  }`
                }
              >
                <Icon name={item.icon} />
                {item.label}
              </NavLink>
            ))}
          </div>
        </nav>
      )}

      <AIAssistant isOpen={isAIAssistantOpen} onClose={() => setIsAIAssistantOpen(false)} />
    </div>
  )
}


