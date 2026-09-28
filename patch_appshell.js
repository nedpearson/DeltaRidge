const fs = require('fs');
let code = fs.readFileSync('src/components/AppShell.tsx', 'utf8');

if (!code.includes('import { useSession }')) {
  code = code.replace("import { outboxCount }", "import { useSession } from '@/features/auth/session'\nimport { outboxCount }");
}

const newFunc = xport function OnlinePill() {
  const { session } = useSession()
  const orgId = session?.membership?.organizationId || null
  const userId = session?.user?.id || null

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

  const label = !online ? 'Offline - saved on device' : pending > 0 ? \\\\\\ waiting to sync\\\ : 'Saved on device'
  const [isSyncing, setIsSyncing] = useState(false)

  const handleSync = async () => {
    if (!online || pending === 0 || isSyncing) return
    setIsSyncing(true)
    if ('vibrate' in navigator) navigator.vibrate(20)
    try {
      await syncOutbox(orgId, userId)
      const newCount = await outboxCount()
      setPending(newCount)
      if (newCount === 0 && 'vibrate' in navigator) navigator.vibrate([20, 50, 20])
    } catch {
      console.warn('Manual sync failed')
    } finally {
      setIsSyncing(false)
    }
  };

const regex = /export function OnlinePill\(\) \{[\s\S]*?finally \{\s*setIsSyncing\(false\)\s*\}\s*\}/m;
code = code.replace(regex, newFunc.replace(/\\\\/g, ''));
fs.writeFileSync('src/components/AppShell.tsx', code);
