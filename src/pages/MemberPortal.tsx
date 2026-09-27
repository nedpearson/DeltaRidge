import { useParams } from 'react-router-dom'
import { Card, Button } from '@/components/ui'
import { ShieldCheck, Calendar, FileText, Zap, CreditCard } from 'lucide-react'

export default function MemberPortal() {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id: _id } = useParams<{ id: string }>()

  // Mocking the member data for the portal view. 
  // In production, this would use a hook like useRoofcareMember(id)
  const member = {
    name: 'Sarah Jenkins',
    address: '1442 Oak Ridge Dr',
    tier: 'Premium Care',
    status: 'active',
    renewsAt: '2027-09-24',
    history: [
      { date: '2026-09-24', type: 'Annual Inspection', status: 'Completed', reportUrl: '#' }
    ]
  }

  return (
    <div className="min-h-screen bg-bg-page pb-16">
      <div className="bg-bg-app border-b border-border-subtle p-4">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-brand-gold" />
            <h1 className="text-[18px] font-black tracking-wide text-text-primary">RoofCare</h1>
          </div>
          <span className="text-[10px] uppercase font-bold tracking-widest text-text-secondary">Member Portal</span>
        </div>
      </div>

      <div className="max-w-md mx-auto p-4 space-y-4">
        <div className="mb-6">
          <h2 className="text-[22px] font-bold text-text-primary">Welcome back, {member.name.split(' ')[0]} (DEMO PREVIEW)</h2>
          <p className="text-[13px] text-text-secondary">{member.address}</p>
        </div>

        {/* Status Card */}
        <Card className="p-5 border-2 border-brand-gold relative overflow-hidden">
          <div className="absolute right-2 top-2"><span className="bg-status-warning text-bg-app px-2 py-0.5 rounded text-[10px] font-bold uppercase">Demo Mode</span></div>
          <div className="absolute -right-6 -top-6 text-brand-gold/10">
            <ShieldCheck className="w-32 h-32" />
          </div>
          <div className="relative z-10">
            <span className="inline-block px-2 py-0.5 bg-status-success/20 text-status-success text-[10px] font-bold uppercase rounded-sm mb-2">Active</span>
            <h3 className="text-[18px] font-bold text-text-primary">{member.tier}</h3>
            <p className="text-[13px] text-text-secondary mt-1">
              RoofCare membership active through {member.renewsAt}.
            </p>
            <div className="mt-4 pt-4 border-t border-border-subtle/50 flex gap-2">
              <Button variant="primary" className="text-[12px] bg-brand-gold text-bg-app hover:bg-brand-goldHighlight w-full" disabled title="Billing integration not yet enabled in demo mode">
                <CreditCard className="w-4 h-4 mr-2" /> Manage Billing
              </Button>
            </div>
          </div>
        </Card>

        {/* Priority Dispatch Status */}
        <Card className="p-4 border border-border-subtle bg-bg-app">
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-status-success/20 flex items-center justify-center shrink-0">
              <Zap className="w-4 h-4 text-status-success" />
            </div>
            <div>
              <h4 className="text-[14px] font-bold text-text-primary">Storm Monitoring Active</h4>
              <p className="text-[12px] text-text-secondary mt-1 leading-relaxed">
                No qualifying storm event is currently attached to this property record.
              </p>
              <Button variant="secondary" className="text-[10px] uppercase tracking-widest mt-2">Show Evidence</Button>
            </div>
          </div>
        </Card>

        {/* Service History */}
        <div className="pt-2">
          <h3 className="text-[13px] font-bold uppercase tracking-widest text-text-secondary mb-3">Service History</h3>
          <div className="space-y-3">
            {member.history.map((item, idx) => (
              <Card key={idx} className="p-3 flex items-center justify-between border-border-subtle">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded bg-bg-app flex items-center justify-center">
                    <Calendar className="w-5 h-5 text-text-muted" />
                  </div>
                  <div>
                    <h4 className="text-[14px] font-bold text-text-primary">{item.type}</h4>
                    <p className="text-[11px] text-text-secondary">{item.date} • {item.status}</p>
                  </div>
                </div>
                <Button variant="secondary" className="text-[11px] px-3 py-1" disabled title="Report generation disabled in demo mode">
                  <FileText className="w-3 h-3 mr-1" /> View Report
                </Button>
              </Card>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}





