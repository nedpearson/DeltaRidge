import { Card, SectionTitle } from '@/components/ui'
import { ShieldAlert, CheckCircle2 } from 'lucide-react'

export default function SettingsPage() {
  return (
    <div className="max-w-2xl pb-32">
      
      <div className="mt-6 space-y-6">
        <SectionTitle hint="Production API keys are managed securely via Supabase Vault/deployment secrets, not in the browser.">
          INTEGRATION SECRETS
        </SectionTitle>

        <Card className="bg-bg-card p-5 ring-1 ring-border-subtle shadow-sm">
          <div className="space-y-4">
            
            <div className="flex justify-between items-center border-b border-border-subtle pb-3">
              <div>
                <p className="text-[13px] font-semibold text-text-primary flex items-center gap-2">
                  OpenAI API Key
                </p>
                <p className="text-[11px] text-text-secondary mt-1">Used for AI Concierge, Call Summaries, and Playbooks.</p>
              </div>
              <div className="flex items-center gap-2 text-status-success text-[12px] font-bold">
                 <CheckCircle2 className="w-4 h-4" /> Configured
              </div>
            </div>

            <div className="flex justify-between items-center border-b border-border-subtle pb-3">
              <div>
                <p className="text-[13px] font-semibold text-text-primary flex items-center gap-2">
                  Meta Access Token
                </p>
                <p className="text-[11px] text-text-secondary mt-1">Used for Facebook/Instagram Lead Ads and Messenger Inbox.</p>
              </div>
              <div className="flex items-center gap-2 text-status-success text-[12px] font-bold">
                 <CheckCircle2 className="w-4 h-4" /> Configured
              </div>
            </div>

            <div className="flex justify-between items-center">
              <div>
                <p className="text-[13px] font-semibold text-text-primary flex items-center gap-2">
                  Twilio Auth Token
                </p>
                <p className="text-[11px] text-text-secondary mt-1">Used for SMS Follow-up and Referral links.</p>
              </div>
              <div className="flex items-center gap-2 text-status-error text-[12px] font-bold">
                 <ShieldAlert className="w-4 h-4" /> Not Configured
              </div>
            </div>

          </div>
        </Card>
      </div>
    </div>
  )
}
