import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import { setUpdateAvailable } from '@/lib/sw-update'
import App from './App'
import './index.css'

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Root element missing from index.html')

createRoot(rootEl).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)

/**
 * Offline is the point, not a nicety. The worker is registered here and the
 * app decides when to apply an update - see src/lib/sw-update.ts for the
 * policy.
 *
 * The periodic check matters as much as the policy. A rep installs the PWA and
 * then keeps it open for days; without an explicit `update()` the browser may
 * not look for a new worker again for a very long time, so a deploy can go
 * unseen no matter how good the banner is. Checking on an interval and
 * whenever the app comes back to the foreground closes that.
 */
const UPDATE_CHECK_MS = 30 * 60 * 1000

const updateSW = registerSW({
  onNeedRefresh() {
    setUpdateAvailable(updateSW)
  },
  onRegisteredSW(_url, registration) {
    if (!registration) return
    const check = () => {
      if (navigator.onLine) void registration.update().catch(() => undefined)
    }
    window.setInterval(check, UPDATE_CHECK_MS)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check()
    })
    window.addEventListener('online', check)
  },
})
