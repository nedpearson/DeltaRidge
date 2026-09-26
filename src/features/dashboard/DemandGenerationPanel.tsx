import { Card, Button, TextInput } from '@/components/ui'
import { Webhook, Mail, Copy, CheckCircle2 } from 'lucide-react'
import { useState } from 'react'

export function DemandGenerationPanel({ organizationId }: { organizationId: string }) {
  const [copied, setCopied] = useState(false)
  // Mocking the endpoint URL for display
  const webhookUrl = 'https://udrxvpkihkbrudvwggpr.supabase.co/functions/v1/ingest-lead?org_id=' + organizationId

  const handleCopy = () => {
    navigator.clipboard.writeText(webhookUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-4">
      <Card className="p-4 border border-border-subtle bg-bg-app">
        <div className="flex items-center gap-2 mb-2">
          <Webhook className="w-5 h-5 text-brand-primary" />
          <h3 className="text-[14px] font-bold text-text-primary uppercase tracking-widest">Inbound Webhook Engine</h3>
        </div>
        <p className="text-[12px] text-text-secondary leading-relaxed max-w-lg mb-4">
          Automatically ingest leads from Facebook Ads, Google Ads, or Zapier directly into Delta Ridge. Inbound leads are scored aggressively and dropped into the unassigned queue.
        </p>
        
        <div className="space-y-2">
          <label className="text-[11px] font-bold text-text-secondary uppercase tracking-widest">Your Webhook URL</label>
          <div className="flex gap-2">
            <TextInput 
              readOnly 
              value={webhookUrl} 
              className="font-mono text-[11px] text-text-muted bg-bg-page"
            />
            <Button variant="secondary" onClick={handleCopy} className="shrink-0 px-3">
              {copied ? <CheckCircle2 className="w-4 h-4 text-status-success" /> : <Copy className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-4 border border-border-subtle bg-bg-app">
        <div className="flex justify-between items-start">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Mail className="w-5 h-5 text-text-muted" />
              <h3 className="text-[14px] font-bold text-text-primary uppercase tracking-widest">Automated Direct Mail (Lob.com)</h3>
            </div>
            <p className="text-[12px] text-text-secondary leading-relaxed max-w-lg mb-4">
              Trigger "Neighborhood Blast" postcards to properties immediately surrounding a newly won contract or a severe storm cell.
            </p>
          </div>
          <span className="inline-block px-2 py-0.5 bg-status-success/20 text-status-success text-[10px] font-bold uppercase rounded-sm">Active</span>
        </div>
      </Card>
    </div>
  )
}



