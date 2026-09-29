import { Card, Button, TextInput } from '@/components/ui'
import { Webhook, Mail, Copy, CheckCircle2, RotateCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { getSupabase } from '@/lib/supabase'
import { loadEnv } from '@/lib/env'

export function DemandGenerationPanel({ organizationId }: { organizationId: string }) {
  const [copied, setCopied] = useState<'url' | 'token' | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [rotatedAt, setRotatedAt] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const webhookUrl = useMemo(
    () => `${loadEnv().VITE_SUPABASE_URL}/functions/v1/ingest-lead`,
    [],
  )

  useEffect(() => {
    const supabase = getSupabase()
    if (!supabase) return
    void supabase
      .from('inbound_lead_webhook_settings')
      .select('secret_hint, rotated_at')
      .eq('organization_id', organizationId)
      .maybeSingle()
      .then(({ data, error: readError }) => {
        if (readError) {
          setError(readError.message)
          return
        }
        setHint(data?.secret_hint ?? null)
        setRotatedAt(data?.rotated_at ?? null)
      })
  }, [organizationId])

  async function copy(value: string, kind: 'url' | 'token') {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(kind)
      window.setTimeout(() => setCopied(null), 1500)
    } catch {
      setError('Clipboard access was denied. Copy the value manually.')
    }
  }

  async function rotateCredential() {
    const supabase = getSupabase()
    if (!supabase) {
      setError('Server connection is not configured.')
      return
    }
    setBusy(true)
    setError(null)
    setToken(null)
    const { data, error: rotateError } = await supabase.rpc('rotate_inbound_lead_webhook_secret', {
      target_org: organizationId,
    })
    setBusy(false)

    if (rotateError) {
      setError(rotateError.message)
      return
    }

    const raw = typeof data === 'string' ? data : null
    if (!raw) {
      setError('The server did not return a new webhook credential.')
      return
    }
    setToken(raw)
    setHint(raw.slice(-6))
    setRotatedAt(new Date().toISOString())
  }

  return (
    <div className="space-y-4">
      <Card className="p-4 border border-border-subtle bg-bg-app">
        <div className="flex items-center gap-2 mb-2">
          <Webhook className="w-5 h-5 text-brand-primary" />
          <h3 className="text-[14px] font-bold text-text-primary uppercase tracking-widest">Inbound Webhook Engine</h3>
        </div>
        <p className="text-[12px] text-text-secondary leading-relaxed max-w-lg mb-4">
          Receive leads from an external automation into the canonical Delta Ridge property/customer/lead pipeline.
          The organization is derived from a private webhook token, never from the inbound payload.
        </p>

        <div className="space-y-2">
          <label className="text-[11px] font-bold text-text-secondary uppercase tracking-widest">Webhook URL</label>
          <div className="flex gap-2">
            <TextInput readOnly value={webhookUrl} className="font-mono text-[11px] text-text-muted bg-bg-page" />
            <Button variant="secondary" onClick={() => void copy(webhookUrl, 'url')} className="shrink-0 px-3">
              {copied === 'url' ? <CheckCircle2 className="w-4 h-4 text-status-success" /> : <Copy className="w-4 h-4" />}
            </Button>
          </div>
          <p className="text-[11px] text-text-secondary">
            Send the credential as <code>x-delta-ridge-token</code>. Do not put an organization ID or secret in the URL.
          </p>
        </div>

        <div className="mt-4 border-t border-border-subtle pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-[12px] font-semibold text-text-primary">Webhook credential</p>
              <p className="text-[11px] text-text-secondary">
                {hint ? `Configured · ends in ${hint}${rotatedAt ? ` · rotated ${new Date(rotatedAt).toLocaleString()}` : ''}` : 'Not configured'}
              </p>
            </div>
            <Button variant="secondary" onClick={() => void rotateCredential()} disabled={busy}>
              <RotateCw className="w-4 h-4 mr-1" /> {busy ? 'Rotating…' : hint ? 'Rotate token' : 'Create token'}
            </Button>
          </div>

          {token && (
            <div className="mt-3 rounded-lg border border-status-warning/30 bg-status-warning/10 p-3">
              <p className="text-[11px] font-semibold text-status-warning">Copy this token now. It will not be shown again.</p>
              <div className="mt-2 flex gap-2">
                <TextInput readOnly value={token} className="font-mono text-[11px] bg-bg-page" />
                <Button variant="secondary" onClick={() => void copy(token, 'token')} className="shrink-0 px-3">
                  {copied === 'token' ? <CheckCircle2 className="w-4 h-4 text-status-success" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
            </div>
          )}

          {error && <p className="mt-3 text-[12px] text-status-critical">{error}</p>}
        </div>
      </Card>

      <Card className="p-4 border border-border-subtle bg-bg-app">
        <div className="flex justify-between items-start">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Mail className="w-5 h-5 text-text-muted" />
              <h3 className="text-[14px] font-bold text-text-primary uppercase tracking-widest">Automated Direct Mail (Lob.com)</h3>
            </div>
            <p className="text-[12px] text-text-secondary leading-relaxed max-w-lg">
              Direct mail remains unavailable until the production provider credential and sender identity are configured.
            </p>
          </div>
          <span className="inline-block px-2 py-0.5 bg-border-subtle text-text-muted text-[10px] font-bold uppercase rounded-sm">NOT CONFIGURED</span>
        </div>
      </Card>
    </div>
  )
}
