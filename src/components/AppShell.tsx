import { NavLink, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { outboxCount } from '@/lib/db'

const NAV = [
  { to: '/', label: 'Home', icon: 'home' },
  { to: '/inspections', label: 'Inspections', icon: 'clipboard' },
  { to: '/new', label: 'Inspect', icon: 'camera', primary: true },
] as const

function Icon({ name }: { name: string }) {
  const common = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  if (name === 'home') return <svg {...common} aria-hidden="true"><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></svg>
  if (name === 'clipboard') return <svg {...common} aria-hidden="true"><rect x="6" y="4" width="12" height="17" rx="2" /><path d="M9 4V3h6v1" /><path d="M9 10h6M9 14h6M9 18h3" /></svg>
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
  const tone = !online ? 'bg-amber-500/15 text-amber-300 ring-amber-500/30' : 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/25'

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ${tone}`}>
      <span className="size-1.5 rounded-full bg-current" />
      {label}
    </span>
  )
}

export default function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const hideNav = pathname.startsWith('/inspection/')

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-screen-sm flex-col">
      <header className="sticky top-0 z-20 border-b border-white/5 bg-[var(--color-surface)]/90 backdrop-blur">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="grid size-8 place-items-center rounded-md bg-brand-500 font-display text-sm font-bold text-white">DR</div>
            <div className="leading-none">
              <div className="font-display text-[15px] tracking-wide">Delta Ridge</div>
              <div className="mt-0.5 text-[10px] uppercase tracking-widest text-white/40">Field</div>
            </div>
          </div>
          <OnlinePill />
        </div>
      </header>

      <main className={`flex-1 px-4 pt-4 ${hideNav ? 'pb-6' : 'pb-24'}`}>{children}</main>

      {!hideNav && (
        <nav className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-screen-sm border-t border-white/5 bg-[var(--color-surface-2)]/95 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur">
          <div className="grid grid-cols-3">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors ${
                    isActive ? 'text-brand-300' : 'text-white/45'
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
    </div>
  )
}
