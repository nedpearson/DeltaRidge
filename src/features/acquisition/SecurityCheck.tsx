import { useEffect, useRef } from 'react'
interface Turnstile {
  render: (element: HTMLElement, options: Record<string, unknown>) => string
  remove: (id: string) => void
}
declare global { interface Window { turnstile?: Turnstile } }
export default function SecurityCheck({ onToken, reset }: { onToken: (token: string) => void; reset: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const callback = useRef(onToken)
  callback.current = onToken
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY
  useEffect(() => {
    if (!siteKey) return
    let widget: string | undefined
    let cancelled = false
    const render = () => {
      if (cancelled || !ref.current || !window.turnstile) return
      widget = window.turnstile.render(ref.current, { sitekey: siteKey, action: 'inspection_request',
        callback: (token: string) => callback.current(token), 'expired-callback': () => callback.current(''),
        'error-callback': () => callback.current('') })
    }
    let script = document.querySelector<HTMLScriptElement>('script[data-roof-security]')
    if (window.turnstile) render()
    else {
      if (!script) {
        script = document.createElement('script')
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
        script.dataset.roofSecurity = 'true'
        script.async = true
        document.head.appendChild(script)
      }
      script.addEventListener('load', render)
    }
    return () => { cancelled = true; script?.removeEventListener('load', render); if (widget) window.turnstile?.remove(widget) }
  }, [siteKey, reset])
  return siteKey ? <div ref={ref} aria-label="Security check" /> : <p className="text-sm text-slate-600">Online inspection requests are not configured yet. Please contact the office.</p>
}
