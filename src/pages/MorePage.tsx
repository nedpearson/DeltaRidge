import { useNavigate } from 'react-router-dom'
import {
  BarChart3,
  Bot,
  CalendarDays,
  ChevronRight,
  Gauge,
  GraduationCap,
  Inbox,
  Settings,
  Sparkles,
} from 'lucide-react'
import { ActionRow, Card, PageHeader, SectionTitle } from '@/components/ui'
import AccountPanel from '@/features/auth/AccountPanel'
import SyncPanel from '@/features/auth/SyncPanel'
import { useSession } from '@/features/auth/session'

export default function MorePage() {
  const navigate = useNavigate()
  const { membership } = useSession()
  const canManage = membership?.role === 'admin' || membership?.role === 'manager'

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Workspace"
        title="More"
        description="Account, training, management and growth tools without crowding the primary field navigation."
      />

      <div>
        <SectionTitle>FIELD TOOLS</SectionTitle>
        <Card className="!p-1">
          <ActionRow
            icon={<GraduationCap size={19} />}
            title="Training Simulator"
            description="Practice the field workflow without touching production records."
            trailing={<ChevronRight size={18} />}
            onClick={() => navigate('/training')}
          />
          <div className="mx-3 border-t border-border-subtle" />
          <ActionRow
            icon={<Settings size={19} />}
            title="Settings & Integrations"
            description="Profile, organization, provider health and AI configuration."
            trailing={<ChevronRight size={18} />}
            onClick={() => navigate('/settings')}
          />
        </Card>
      </div>

      {canManage && (
        <div>
          <SectionTitle>MANAGEMENT</SectionTitle>
          <Card className="!p-1">
            <ActionRow
              icon={<Gauge size={19} />}
              title="Manager Command Center"
              description="Assignments, team activity, territories, revenue and operational exceptions."
              trailing={<ChevronRight size={18} />}
              onClick={() => navigate('/manager')}
            />
          </Card>
        </div>
      )}

      <div>
        <SectionTitle>GROWTH OS</SectionTitle>
        {canManage && <Card className="mb-3 !p-1"><ActionRow icon={<BarChart3 size={19} />} title="Inbound Acquisition" description="Inspection requests, booking, campaign links and measured acquisition cost." trailing={<ChevronRight size={18} />} onClick={() => navigate('/acquisition')} /></Card>}
        <Card className="!p-1">
          <ActionRow
            icon={<Inbox size={19} />}
            title="Unified Inbox"
            description="Work social conversations and lead handoffs."
            trailing={<ChevronRight size={18} />}
            onClick={() => navigate('/inbox')}
          />
          <div className="mx-3 border-t border-border-subtle" />
          <ActionRow
            icon={<Sparkles size={19} />}
            title="Creative Studio"
            description="Create and prepare approved social content."
            trailing={<ChevronRight size={18} />}
            onClick={() => navigate('/studio')}
          />
          <div className="mx-3 border-t border-border-subtle" />
          <ActionRow
            icon={<CalendarDays size={19} />}
            title="Content Calendar"
            description="Approve, schedule and verify publishing."
            trailing={<ChevronRight size={18} />}
            onClick={() => navigate('/calendar')}
          />
          <div className="mx-3 border-t border-border-subtle" />
          <ActionRow
            icon={<BarChart3 size={19} />}
            title="Social ROI"
            description="Measured funnel, spend, signed revenue and attribution."
            trailing={<ChevronRight size={18} />}
            onClick={() => navigate('/social-metrics')}
          />
          <div className="mx-3 border-t border-border-subtle" />
          <ActionRow
            icon={<Bot size={19} />}
            title="Autonomy Controls"
            description="Manager-controlled safeguards for automated social actions."
            trailing={<ChevronRight size={18} />}
            onClick={() => navigate('/autonomy')}
          />
        </Card>
      </div>

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
