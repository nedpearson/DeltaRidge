import { useEffect, useState } from 'react'
import { Card, SectionTitle } from '@/components/ui'
import { ShieldAlert, CheckCircle2, Loader2 } from 'lucide-react'
import { getSupabase } from '@/lib/supabase'
import { useSession } from '@/features/auth/session'

interface IntegrationStatus {
  openai: boolean
  meta: boolean
  twilio: boolean
}

export default function SettingsPage() {
  const { session, membership } = useSession()
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<IntegrationStatus>({
    openai: false,
    meta: false,
    twilio: false
  })

  useEffect(() => {
    async function checkIntegrations() {
      const supabase = getSupabase()
      const orgId = membership?.organizationId
      if (!supabase || !orgId) {
        setLoading(false)
        return
      }

      // Check for active social accounts
      const { count: metaCount } = await supabase
        .from('social_accounts')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .eq('platform', 'meta')
        .not('encrypted_access_token', 'is', null)

      // Check general integrations table
      const { data: integrations } = await supabase
        .from('integration_connections')
        .select('provider, is_enabled')
        .eq('organization_id', orgId)

      const hasTwilio = integrations?.some(i => i.provider === 'twilio' && i.is_enabled)
      
      // Since OpenAI is often global, we check if there's an enabled 'openai' provider row,
      // or we assume true if they're authenticated (for demo purposes we map to row).
      const hasOpenAI = integrations?.some(i => i.provider === 'openai' && i.is_enabled)

      setStatus({
        meta: (metaCount || 0) > 0,
        twilio: !!hasTwilio,
        openai: !!hasOpenAI
      })
      
      setLoading(false)
    }

    void checkIntegrations()
  }, [membership])

  return (
    <div className="max-w-2xl pb-32">
      <div className="mt-6 space-y-6">
        <SectionTitle hint="Production API keys are managed securely via Supabase Vault/deployment secrets, not in the browser.">
          INTEGRATION SECRETS
        </SectionTitle>

        <Card className="bg-bg-card p-5 ring-1 ring-border-subtle shadow-sm">
          {loading ? (
             <div className="flex justify-center p-4"><Loader2 className="w-5 h-5 animate-spin text-brand-primary" /></div>
          ) : (
          <div className="space-y-4">
            <div className="flex justify-between items-center border-b border-border-subtle pb-3">
              <div>
                <p className="text-[13px] font-semibold text-text-primary flex items-center gap-2">
                  OpenAI API Key
                </p>
                <p className="text-[11px] text-text-secondary mt-1">Used for AI Concierge, Call Summaries, and Playbooks.</p>
              </div>
              <div className={\lex items-center gap-2 text-[12px] font-bold \\}>
                 {status.openai ? <><CheckCircle2 className="w-4 h-4" /> Configured</> : <><ShieldAlert className="w-4 h-4" /> Not Configured</>}
              </div>
            </div>

            <div className="flex justify-between items-center border-b border-border-subtle pb-3">
              <div>
                <p className="text-[13px] font-semibold text-text-primary flex items-center gap-2">
                  Meta Access Token
                </p>
                <p className="text-[11px] text-text-secondary mt-1">Used for Facebook/Instagram Lead Ads and Messenger Inbox.</p>
              </div>
              <div className={\lex items-center gap-2 text-[12px] font-bold \\}>
                 {status.meta ? <><CheckCircle2 className="w-4 h-4" /> Configured</> : <><ShieldAlert className="w-4 h-4" /> Not Configured</>}
              </div>
            </div>

            <div className="flex justify-between items-center">
              <div>
                <p className="text-[13px] font-semibold text-text-primary flex items-center gap-2">
                  Twilio Auth Token
                </p>
                <p className="text-[11px] text-text-secondary mt-1">Used for SMS Follow-up and Referral links.</p>
              </div>
              <div className={\lex items-center gap-2 text-[12px] font-bold \\}>
                 {status.twilio ? <><CheckCircle2 className="w-4 h-4" /> Configured</> : <><ShieldAlert className="w-4 h-4" /> Not Configured</>}
              </div>
            </div>
          </div>
          )}
        </Card>
      </div>
    </div>
  )
}
