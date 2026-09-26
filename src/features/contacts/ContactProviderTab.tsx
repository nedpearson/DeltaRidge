import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Field, SectionTitle, Select, TextInput } from '@/components/ui'
import { mayEnrich, type EnrichmentEntitlement } from './enrichment'
import { readProviderSettings, saveProviderSettings, UNSET, type ProviderSettings } from './store'

/**
 * Settings → Integrations → Contact data.
 *
 * The screen's job is to answer "why am I paying BeenVerified and not getting
 * phone numbers", once, in writing, so nobody has to rediscover it.
 */

const FINDINGS: { label: string; value: string; tone: 'ok' | 'warn' | 'plain' }[] = [
  {
    label: 'Official API exists',
    value: 'Yes — apidocs.beenverified.com, POST /v1/append',
    tone: 'ok',
  },
  {
    label: 'Self-serve signup',
    value: 'No. Access is granted per account through their sales team.',
    tone: 'plain',
  },
  {
    label: 'Personal subscription usable',
    value: 'No. Their consumer terms prohibit commercial and lead-list use.',
    tone: 'warn',
  },
  {
    label: 'Business plan exists',
    value: 'Yes — business.beenverified.com, and it names home services.',
    tone: 'ok',
  },
]

const ENTITLEMENTS: { id: EnrichmentEntitlement; label: string }[] = [
  { id: 'none', label: 'Nothing connected' },
  { id: 'consumer_subscription', label: 'Personal subscription only' },
  { id: 'business_api', label: 'Business agreement' },
]

export default function ContactProviderTab({
  organizationId,
  userId,
  canManage,
}: {
  organizationId: string | null
  userId: string | null
  canManage: boolean
}) {
  const [settings, setSettings] = useState<ProviderSettings>(UNSET)
  const [basis, setBasis] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (organizationId === null) return
    const next = await readProviderSettings(organizationId)
    setSettings(next)
    setBasis(next.basis ?? '')
  }, [organizationId])

  useEffect(() => {
    void load()
  }, [load])

  const verdict = mayEnrich(settings)

  const save = async (patch: Parameters<typeof saveProviderSettings>[2]) => {
    if (organizationId === null || userId === null) return
    setError(null)
    const result = await saveProviderSettings(organizationId, userId, patch)
    if (!result.ok) {
      setError(result.error)
      return
    }
    await load()
  }

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle hint="Checked 23 September 2026 against BeenVerified's own documentation and terms.">
          BeenVerified
        </SectionTitle>

        <div
          className={`mt-3 rounded-xl px-3 py-3 ring-1 ${
            verdict.allowed
              ? 'bg-status-success/8 ring-emerald-500/25'
              : 'bg-status-warning ring-amber-500/25'
          }`}
        >
          <p className="text-[13px] font-semibold text-text-secondary">
            {verdict.allowed ? 'Lookups are permitted' : 'Lookups are switched off'}
          </p>
          {!verdict.allowed && (
            <>
              <p className="mt-1 text-[12.5px] leading-relaxed text-status-warning/85">
                {verdict.reason}
              </p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-text-secondary">{verdict.remedy}</p>
            </>
          )}
        </div>

        <ul className="mt-3 space-y-2">
          {FINDINGS.map((f) => (
            <li key={f.label} className="border-t border-border-subtle pt-2 first:border-t-0 first:pt-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 shrink-0 text-[12.5px] text-text-secondary">{f.label}</span>
                <span
                  className={`min-w-0 break-words text-right text-[12.5px] ${
                    f.tone === 'warn' ? 'text-status-warning/85' : 'text-text-secondary'
                  }`}
                >
                  {f.value}
                </span>
              </div>
            </li>
          ))}
        </ul>

        {error !== null && (
          <p className="mt-3 rounded bg-status-critical/10 px-3 py-2 text-[12.5px] text-status-critical">{error}</p>
        )}

        <div className="mt-4 border-t border-border-subtle pt-3">
          <Field
            label="What we hold"
            hint="Setting this to a business agreement does not by itself permit anything; the confirmation below does."
          >
            <Select
              value={settings.entitlement}
              disabled={!canManage}
              onChange={(e) => void save({ entitlement: e.target.value as EnrichmentEntitlement })}
            >
              {ENTITLEMENTS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>

          <label className="mt-3 flex items-center gap-3 text-[13px] text-text-secondary">
            <input
              type="checkbox"
              checked={settings.credentialPresent}
              disabled={!canManage}
              onChange={(e) => void save({ credentialPresent: e.target.checked })}
            />
            An API key is set as a server secret
          </label>

          {/*
            The attestation. Not a checkbox on its own: the database refuses a
            confirmation with nobody's name and no date against it, because
            "somebody ticked a box once" is not a record of who decided this.
          */}
          {settings.commercialUseConfirmed ? (
            <div className="mt-3 rounded-xl bg-status-success/8 px-3 py-2.5 ring-1 ring-emerald-500/20">
              <p className="text-[12.5px] text-status-success/90">
                Commercial use confirmed{settings.basis ? `: ${settings.basis}` : ''}
              </p>
              <p className="mt-0.5 text-[11px] text-text-secondary">
                {settings.confirmedAt
                  ? `Recorded ${new Date(settings.confirmedAt).toLocaleDateString()}`
                  : ''}
              </p>
              {canManage && (
                <Button
                  className="mt-2"
                  variant="secondary"
                  onClick={() => void save({ confirmCommercialUse: false })}
                >
                  Withdraw
                </Button>
              )}
            </div>
          ) : (
            canManage && (
              <div className="mt-3">
                <Field
                  label="Confirm commercial use is permitted"
                  hint="Name the agreement. No API response can tell us what contract was signed, so this is attested rather than detected."
                >
                  <TextInput
                    value={basis}
                    placeholder="e.g. BeenVerified Business agreement, 12 Oct 2026"
                    onChange={(e) => setBasis(e.target.value)}
                  />
                </Field>
                <Button
                  className="mt-2"
                  onClick={() => void save({ confirmCommercialUse: { basis } })}
                >
                  Confirm
                </Button>
              </div>
            )
          )}

          <label className="mt-4 flex items-center gap-3 text-[13px] text-text-secondary">
            <input
              type="checkbox"
              checked={settings.secondaryProvidersEnabled}
              disabled={!canManage}
              onChange={(e) => void save({ secondaryProvidersEnabled: e.target.checked })}
            />
            Allow paid fallback providers
          </label>
          <p className="mt-1 text-[11px] text-text-secondary">
            Off by default. Each call to a fallback provider costs money.
          </p>
        </div>

        <p className="mt-3 border-t border-border-subtle pt-2 text-[11.5px] leading-relaxed text-text-secondary">
          No credential is entered on this screen and there is no field that could hold one. The key
          belongs in an Edge Function secret where the browser cannot reach it.
        </p>
      </Card>

      <Card>
        <SectionTitle hint="What works today, with no provider at all.">Getting a number</SectionTitle>
        <ul className="mt-2 space-y-2 text-[12.5px] leading-relaxed text-text-secondary">
          <li>
            <span className="text-text-secondary">The homeowner tells a rep.</span> Governed by nobody’s
            terms, and the only source this app will dial without further checks.
          </li>
          <li>
            <span className="text-text-secondary">A public record.</span> The parish roll is public by
            statute.
          </li>
          <li>
            <span className="text-text-secondary">A provider, under a business agreement.</span> Switched
            on above once one exists.
          </li>
        </ul>
        <p className="mt-3 border-t border-border-subtle pt-2 text-[11.5px] leading-relaxed text-text-secondary">
          Having a number is never permission to dial it. Consent, the internal do-not-call list and
          Louisiana’s calling hours all still apply, and they are checked separately on every lead.
        </p>
      </Card>
    </div>
  )
}
