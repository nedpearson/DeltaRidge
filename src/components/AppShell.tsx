import { NavLink, useLocation } from 'react-router-dom'
import type { CSSProperties, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { outboxCount } from '@/lib/db'

export const NAV = [
  { to: '/', label: 'Home', icon: 'home' },
  { to: '/leads', label: 'Leads', icon: 'target' },
  { to: '/estimate', label: 'Price', icon: 'tag' },
  { to: '/inspections', label: 'Jobs', icon: 'clipboard' },
  { to: '/new', label: 'Inspect', icon: 'camera', primary: true },
] as const

function Icon({ name }: { name: string }) {
  const common = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  if (name === 'home') return <svg {...common} aria-hidden="true"><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></svg>
  if (name === 'clipboard') return <svg {...common} aria-hidden="true"><rect x="6" y="4" width="12" height="17" rx="2" /><path d="M9 4V3h6v1" /><path d="M9 10h6M9 14h6M9 18h3" /></svg>
  if (name === 'target') return <svg {...common} aria-hidden="true"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.2" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2" /></svg>
  if (name === 'tag') return <svg {...common} aria-hidden="true"><path d="M3 12.5V4a1 1 0 0 1 1-1h8.5L21 11.5 12.5 20z" /><circle cx="7.5" cy="7.5" r="1.4" /></svg>
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
  const tone = !online ? 'bg-amber-400/15 text-amber-200 ring-amber-300/30' : 'bg-emerald-400/15 text-emerald-200 ring-emerald-300/30'

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ${tone}`}>
      <span className="size-1.5 rounded-full bg-current" />
      {label}
    </span>
  )
}

/**
 * Keeps the page's bottom padding equal to the nav's real height.
 *
 * Measured rather than declared, because every constant anybody would write
 * here is wrong on some phone: the label font scales with the OS accessibility
 * setting, the home indicator inset differs between devices and between
 * portrait and landscape, and installing the app as a PWA removes the browser
 * chrome that was absorbing the difference. A ResizeObserver on the element
 * itself is the only version that cannot drift out of date.
 *
 * This replaced a hard-coded `pb-24`, which under-reserved by about 58px in the
 * common case and cut the bottom off every long page in the app.
 */
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

    // ResizeObserver catches the nav growing; the orientation listener catches
    // the safe-area inset changing without the element's box changing, which a
    // ResizeObserver alone does not report.
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    window.addEventListener('orientationchange', measure)
    window.addEventListener('resize', measure)

    /*
     * Re-measure once the webfonts land.
     *
     * Caught by running the layout check against the deployed site rather than
     * a local build: the first viewport measured the nav at 26px because
     * Oswald and Poppins had not arrived yet and the labels were still in the
     * fallback face. The ResizeObserver does fire when the nav grows, so the
     * padding self-corrects — but for those few hundred milliseconds the page
     * reserves too little space. On a slow connection in a truck that window is
     * long enough to notice.
     */
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
  const hideNav = pathname.startsWith('/inspection/')
  const { ref: navRef, height: navHeight } = useNavHeight(!hideNav)

  return (
    /*
     * `min-h-dvh`, not `min-h-screen`. On mobile Safari `100vh` is the height
     * with the URL bar hidden, so a `100vh` layout is always taller than the
     * visible viewport and the last row of anything sits under the browser
     * chrome. `dvh` tracks the viewport as it actually is.
     *
     * The column widens past phone size rather than pinning every screen to
     * 640px: a manager on a laptop was reading a phone-width strip down the
     * middle of a 27-inch display.
     */
    <div
      className="mx-auto flex min-h-dvh w-full max-w-screen-sm flex-col md:max-w-3xl lg:max-w-5xl"
      /*
       * Published as a CSS variable, not kept private to this component, because
       * the nav is not the only thing pinned to the bottom of the screen. The
       * update banner used to sit at a hard-coded `bottom-20` and landed on top
       * of the nav the moment the nav grew. One measurement, one source.
       */
      style={{ '--bottom-nav-height': `${navHeight}px` } as CSSProperties}
    >
      <header className="sticky top-0 z-20 border-b border-white/10 bg-brand-900 text-white shadow-lg shadow-brand-950/10">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="grid size-9 place-items-center rounded-lg bg-brand-500 font-display text-sm font-bold text-white shadow-md shadow-black/20 ring-1 ring-white/20">DR</div>
            <div className="leading-none">
              <div className="font-display text-[15px] tracking-wide text-white">Delta Ridge</div>
              <div className="mt-0.5 text-[10px] uppercase tracking-widest text-slate-300">Field</div>
            </div>
          </div>
          <OnlinePill />
        </div>
      </header>

      {/*
        The bottom padding is the nav's measured height plus the safe-area inset
        plus a thumb's worth of breathing room, so the last card on any page can
        always be scrolled clear of the nav. `paddingBottom` is set as a style
        rather than a class because the value is a runtime measurement.
      */}
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
          className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-screen-sm border-t border-white/10 bg-brand-900 px-2 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_rgba(8,21,46,0.18)] md:max-w-3xl lg:max-w-5xl"
        >
          {/*
            The column count is DERIVED from NAV, not written down beside it.
            It said `grid-cols-4` while NAV held five entries, so "Inspect"
            wrapped onto a second row and the nav stood 126px tall where the
            page reserved 96px — measured at -29px of clearance on an iPhone SE,
            which is precisely the content that was disappearing under the nav.
            A hand-maintained number next to a list is a bug waiting for the
            next person to add a tab, so there is no longer a number to maintain.
            Inline style rather than a Tailwind class because the JIT compiler
            cannot generate a class name built at runtime.
          */}
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
                    isActive ? 'bg-white/10 text-brand-300' : 'text-slate-300 hover:bg-white/5 hover:text-white'
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
