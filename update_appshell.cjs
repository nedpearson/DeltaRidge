const fs = require('fs');

const path = 'c:/dev/github/business/DeltaRidge/src/components/AppShell.tsx';
let content = fs.readFileSync(path, 'utf8');

const onlinePillReplace = `export function OnlinePill() {
  const [online, setOnline] = useState(navigator.onLine)
  const [pending, setPending] = useState(0)
  const [stalled, setStalled] = useState(0)

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    const tick = () => {
      void outboxCount().then(setPending).catch(() => undefined)
    }
    tick()
    const timer = window.setInterval(tick, 4000)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
      window.clearInterval(timer)
    }
  }, [])

  const [isSyncing, setIsSyncing] = useState(false)

  const handleSync = async () => {
    if (!online || pending === 0 || isSyncing) return
    setIsSyncing(true)
    if ('vibrate' in navigator) navigator.vibrate(20)
    try {
      const res = await syncOutbox(null, null)
      const newCount = await outboxCount()
      setPending(newCount)
      if (res && res.stalled) setStalled(res.stalled)
      if (newCount === 0 && 'vibrate' in navigator) navigator.vibrate([20, 50, 20])
    } catch {
      console.warn('Manual sync failed')
    } finally {
      setIsSyncing(false)
    }
  }

  const hasConflict = stalled > 0;
  const label = !online ? 'Offline' : hasConflict ? \`\${stalled} conflicts\` : pending > 0 ? \`\${pending} waiting\` : 'Saved on device'
  
  const tone = !online ? 'bg-warning-surface/15 text-warning-highlight ring-warning-border' : hasConflict ? 'bg-status-error/15 text-status-error ring-status-error/30' : isSyncing ? 'bg-brand-primary/15 text-brand-400 ring-brand-400/30' : 'bg-status-success/15 text-status-success ring-emerald-300/30'
  const finalLabel = isSyncing ? 'Syncing...' : label

  return (
    <button 
      onClick={handleSync}
      disabled={!online || pending === 0 || isSyncing}
      className={\`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 transition-all \${tone} \${pending > 0 && online ? 'hover:bg-opacity-20 cursor-pointer active:scale-95' : 'cursor-default'}\`}
    >
      <span className={\`size-1.5 rounded-full bg-current \${isSyncing ? 'animate-ping' : ''}\`} />
      {finalLabel}
    </button>
  )
}`;

content = content.replace(/export function OnlinePill\(\) \{[\s\S]*?return \([\s\S]*?<\/button>\n  \)\n\}/, onlinePillReplace);

fs.writeFileSync(path, content);
console.log('AppShell.tsx updated with stalled/conflict state');
