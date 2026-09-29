import { Card, SectionTitle, TextInput, Field } from '@/components/ui'
import { Bot, Building2, User } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSession } from '@/features/auth/session'
import AccountPanel from '@/features/auth/AccountPanel'
import IntegrationHealthPanel from '@/features/integrations/health/IntegrationHealthPanel'

const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrator',
  manager: 'Manager',
  salesperson: 'Field Representative',
  office: 'Office',
  inspector: 'Inspector',
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<'profile' | 'org' | 'integrations' | 'ai'>('profile')
  const { session, membership, membershipError, profile, updateProfile } = useSession()
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [localName, setLocalName] = useState('')
  const [localPhone, setLocalPhone] = useState('')

  useEffect(() => {
    setLocalName(profile?.fullName ?? '')
    setLocalPhone(profile?.phone ?? '')
  }, [profile?.fullName, profile?.phone])

  if (!session) {
    return (
      <div className="max-w-md mx-auto mt-12 space-y-6">
        <h2 className="text-xl font-bold text-center">Settings & Integrations</h2>
        <Card className="p-6">
          <p className="text-sm text-text-secondary mb-4 text-center">You must be signed in to manage your account and integrations.</p>
          <AccountPanel />
        </Card>
      </div>
    )
  }

  const handleSaveProfile = async () => {
    setSaving(true)
    setSaveError(null)
    setSaved(false)
    const result = await updateProfile({ fullName: localName.trim() || null, phone: localPhone.trim() || null })
    setSaving(false)
    if (result.error) {
      setSaveError(result.error)
      return
    }
    setSaved(true)
  }

  const aiProvider = String(import.meta.env.VITE_AI_PROVIDER ?? 'none')

  return (
    <div className="max-w-3xl pb-32">
      <div className="mt-4 mb-6 border-b border-border-subtle flex gap-6 overflow-x-auto no-scrollbar">
        <button onClick={() => setActiveTab('profile')} className={`pb-3 text-[13px] font-bold tracking-wide transition-colors ${activeTab === 'profile' ? 'text-brand-400 border-b-2 border-brand-400' : 'text-text-secondary hover:text-text-primary'}`}>PROFILE</button>
        <button onClick={() => setActiveTab('org')} className={`pb-3 text-[13px] font-bold tracking-wide transition-colors ${activeTab === 'org' ? 'text-brand-400 border-b-2 border-brand-400' : 'text-text-secondary hover:text-text-primary'}`}>ORGANIZATION</button>
        <button onClick={() => setActiveTab('integrations')} className={`pb-3 text-[13px] font-bold tracking-wide transition-colors ${activeTab === 'integrations' ? 'text-brand-400 border-b-2 border-brand-400' : 'text-text-secondary hover:text-text-primary'}`}>INTEGRATIONS</button>
        <button onClick={() => setActiveTab('ai')} className={`pb-3 text-[13px] font-bold tracking-wide transition-colors ${activeTab === 'ai' ? 'text-brand-400 border-b-2 border-brand-400' : 'text-text-secondary hover:text-text-primary'}`}>AI SETUP</button>
      </div>

      {membershipError && (
        <Card className="mb-6 bg-warning-surface ring-1 ring-warning-border">
          <p className="text-sm text-status-warning">Organization access could not be verified: {membershipError}</p>
        </Card>
      )}

      <div className="space-y-6">
        {activeTab === 'integrations' && (
          <IntegrationHealthPanel organizationId={membership?.organizationId ?? null} />
        )}

        {activeTab === 'profile' && (
          <>
            <SectionTitle>PERSONAL PROFILE</SectionTitle>
            <Card className="space-y-4 p-5">
              <div className="flex items-center gap-4 mb-4">
                <div className="size-16 rounded-full bg-brand-primary/20 flex items-center justify-center text-brand-400">
                  <User size={32} />
                </div>
                <div>
                  <p className="text-lg font-bold">{profile?.fullName || session.user.email}</p>
                  {profile?.fullName && <p className="text-sm text-text-secondary">{session.user.email}</p>}
                  <p className="text-sm text-text-secondary">{membership ? ROLE_LABEL[membership.role] ?? membership.role : 'No organization access'}</p>
                </div>
              </div>
              <Field label="Full Name">
                <TextInput value={localName} onChange={(e) => { setLocalName(e.target.value); setSaved(false) }} placeholder="Full name" />
              </Field>
              <Field label="Phone Number">
                <TextInput value={localPhone} onChange={(e) => { setLocalPhone(e.target.value); setSaved(false) }} placeholder="Phone number" inputMode="tel" />
              </Field>
              <button
                type="button"
                onClick={() => void handleSaveProfile()}
                disabled={saving}
                className="w-full rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
              >
                {saving ? 'Saving…' : 'Save profile'}
              </button>
              {saveError && <p className="text-xs text-status-critical">{saveError}</p>}
              {saved && <p className="text-xs text-status-success">Profile saved.</p>}
            </Card>
          </>
        )}

        {activeTab === 'org' && (
          <>
            <SectionTitle>ORGANIZATION DETAILS</SectionTitle>
            <Card className="space-y-4 p-5">
              <div className="flex items-center gap-3">
                <Building2 className="text-brand-400" size={24} />
                <div>
                  <h3 className="text-lg font-bold">{membership?.organizationName || 'No Organization'}</h3>
                  <p className="text-[13px] text-text-secondary">
                    Access level: <span className="font-bold text-text-primary">{membership ? ROLE_LABEL[membership.role] ?? membership.role : 'None'}</span>
                  </p>
                </div>
              </div>
              {!membership && (
                <p className="text-[13px] text-status-warning">
                  This signed-in account is not attached to an active organization. Organization-scoped features will remain unavailable until membership is restored.
                </p>
              )}
            </Card>
          </>
        )}

        {activeTab === 'ai' && (
          <>
            <SectionTitle>AI & AUTOMATION</SectionTitle>
            <Card className="p-5 space-y-3">
              <div className="flex items-start gap-3">
                <Bot className="w-5 h-5 text-brand-400 mt-0.5" />
                <div>
                  <p className="text-[13px] font-semibold text-text-primary">Configured client mode</p>
                  <p className="text-[12px] text-text-secondary capitalize">{aiProvider === 'none' ? 'AI disabled' : aiProvider}</p>
                </div>
              </div>
              <p className="text-[12px] leading-relaxed text-text-secondary">
                Server API keys are intentionally not exposed to the browser. A provider is not shown as working here merely because a deployment secret may exist; successful feature calls and integration health are the authority.
              </p>
            </Card>
          </>
        )}
      </div>
    </div>
  )
}
