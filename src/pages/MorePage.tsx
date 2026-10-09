import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity, BarChart3, Bot, Brain, CalendarDays, ChevronRight, CloudLightning, Gauge, GraduationCap,
  History, Inbox, Link2, Receipt, Settings, Sparkles, Stethoscope,
} from 'lucide-react'
import { Card, PageHeader, SectionTitle } from '@/components/ui'
import AccountPanel from '@/features/auth/AccountPanel'
import SyncPanel from '@/features/auth/SyncPanel'
import { useSession } from '@/features/auth/session'
import { summarize, useCapabilities } from '@/features/system/capabilities'
import { STATE_UI } from '@/pages/StatusPage'

/**
 * Everything that is not one of the four everyday tabs, grouped by job.
 * Rows backed by an integration show whether it is live, so nothing here
 * pretends to work when it is not set up.
 */

interface Item { to: string; icon: ReactNode; title: string; sub: string; badge?: string | undefined; external?: boolean }

function Group({ title, items }: { title: string; items: Item[] }) {
  return (
    <div>
      <SectionTitle>{title}</SectionTitle>
      <Card className="!p-1">
        {items.map((it, i) => {
          const body = (
            <>
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-bg-elevated text-text-secondary">{it.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14.5px] font-semibold text-text-primary">{it.title}</span>
                <span className="block text-[12.5px] leading-snug text-text-secondary">{it.sub}</span>
              </span>
              {it.badge && <span className="shrink-0 rounded-md bg-bg-elevated px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-text-muted">{it.badge}</span>}
              <ChevronRight size={16} className="shrink-0 text-text-muted" />
            </>
          )
          const cls = 'flex min-h-14 items-center gap-3 rounded-xl px-3 py-2.5 active:bg-bg-elevated'
          return (
            <div key={it.to}>
              {i > 0 && <div className="mx-3 border-t border-border-subtle" />}
              {it.external
                ? <a href={it.to} target="_blank" rel="noreferrer" className={cls}>{body}</a>
                : <Link to={it.to} className={cls}>{body}</Link>}
            </div>
          )
        })}
      </Card>
    </div>
  )
}

export default function MorePage() {
  const { membership } = useSession()
  const canManage = membership?.role === 'admin' || membership?.role === 'manager'
  const caps = useCapabilities()
  const s = summarize(caps)
  const social = caps.find((c) => c.id === 'social')
  const socialBadge = social && social.state !== 'live' ? STATE_UI[social.state].word : undefined

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Workspace" title="More" />

      <Group title="STATUS" items={[
        { to: '/status', icon: <Activity size={18} />, title: "What's live", sub: `${s.live} working · ${s.setup} not set up${s.problems ? ` · ${s.problems} problem` : ''}`, badge: s.problems ? 'Check' : undefined },
      ]} />

      <Group title="FIELD" items={[
        { to: '/storm-os', icon: <CloudLightning size={18} />, title: 'Storms', sub: 'Hail swaths, storm dates and target areas' },
        { to: '/routes', icon: <History size={18} />, title: 'Route history', sub: 'Your past routes, trails and door outcomes' },
        { to: '/free-roof-check', icon: <Link2 size={18} />, title: 'Storm check page', sub: 'The homeowner page — open it with a customer', external: true },
        { to: '/training', icon: <GraduationCap size={18} />, title: 'Training simulator', sub: 'Practice without touching real records' },
      ]} />

      {canManage && (
        <Group title="MANAGE" items={[
          { to: '/manager', icon: <Gauge size={18} />, title: 'Team & assignments', sub: 'Who is out, doors, territories, exceptions' },
          { to: '/costs', icon: <Receipt size={18} />, title: 'Cost book', sub: 'Material and labour costs the estimator prices from' },
          { to: '/diagnostics', icon: <Stethoscope size={18} />, title: 'Diagnostics', sub: 'Device, sync and data checks' },
        ]} />
      )}

      {canManage && (
        <Group title="MARKETING" items={[
          { to: '/inbox', icon: <Inbox size={18} />, title: 'Social inbox', sub: 'Facebook and Instagram conversations', badge: socialBadge },
          { to: '/studio', icon: <Sparkles size={18} />, title: 'Creative studio', sub: 'Make posts and ads', badge: socialBadge },
          { to: '/calendar', icon: <CalendarDays size={18} />, title: 'Content calendar', sub: 'Approve and schedule posts', badge: socialBadge },
          { to: '/social-metrics', icon: <BarChart3 size={18} />, title: 'Marketing results', sub: 'Spend, leads and signed revenue by channel', badge: socialBadge },
          { to: '/brain', icon: <Brain size={18} />, title: 'Brand voice', sub: 'What the content tools know about Delta Ridge', badge: socialBadge },
          { to: '/autonomy', icon: <Bot size={18} />, title: 'Automation controls', sub: 'What automated posting and replies may do', badge: socialBadge },
        ]} />
      )}

      <Group title="SETTINGS" items={[
        { to: '/settings', icon: <Settings size={18} />, title: 'Settings & integrations', sub: 'Profile, notifications, providers, connection history' },
      ]} />

      <div>
        <SectionTitle>ACCOUNT & SYNC</SectionTitle>
        <div className="grid gap-3 md:grid-cols-2">
          <AccountPanel />
          <SyncPanel />
        </div>
      </div>
    </div>
  )
}
