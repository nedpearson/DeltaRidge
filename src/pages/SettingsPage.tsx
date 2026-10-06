import { useState, useEffect } from 'react'
import { Card, SectionTitle, Field, TextInput } from '@/components/ui'
import { User, Building2 } from 'lucide-react'
import { useSession } from '@/features/auth/session'
import AccountPanel from '@/features/auth/AccountPanel'
import IntegrationHealthPanel from '@/features/integrations/health/IntegrationHealthPanel'

type TabType = 'account' | 'org' | 'team' | 'leads' | 'storms' | 'field' | 'contacts' | 'comms' | 'ai' | 'integrations' | 'compliance' | 'health'

const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrator',
  manager: 'Manager',
  salesperson: 'Field Representative',
  office: 'Office',
  inspector: 'Inspector',
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabType>('account')
  const { session, membership, membershipError, profile, updateProfile } = useSession()
  const [saving, setSaving] = useState(false)
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
        <h2 className="text-xl font-bold text-center">Settings</h2>
        <Card className="p-6">
          <p className="text-sm text-text-secondary mb-4 text-center">You must be signed in to manage your account.</p>
          <AccountPanel />
        </Card>
      </div>
    )
  }

  const handleSaveProfile = async () => {
    setSaving(true)
    setSaved(false)
    await updateProfile({ fullName: localName.trim() || null, phone: localPhone.trim() || null })
    setSaving(false)
    setSaved(true)
  }

  return (
    <div className="max-w-4xl mx-auto pb-32 pt-6 px-4">
      <h1 className="text-2xl font-display font-bold text-text-primary mb-6">Settings</h1>
      
      <div className="flex flex-col md:flex-row gap-8">
        <div className="w-full md:w-56 shrink-0 flex md:flex-col gap-1 overflow-x-auto no-scrollbar pb-2">
          <button onClick={() => setActiveTab('account')} className={`text-left px-3 py-2 text-sm font-semibold rounded-md transition-colors whitespace-nowrap ${activeTab === 'account' ? 'bg-brand-primary/10 text-brand-primary' : 'text-text-secondary hover:bg-bg-elevated hover:text-text-primary'}`}>My Account</button>
          <button onClick={() => setActiveTab('org')} className={`text-left px-3 py-2 text-sm font-semibold rounded-md transition-colors whitespace-nowrap ${activeTab === 'org' ? 'bg-brand-primary/10 text-brand-primary' : 'text-text-secondary hover:bg-bg-elevated hover:text-text-primary'}`}>Organization</button>
          <button onClick={() => setActiveTab('team')} className={`text-left px-3 py-2 text-sm font-semibold rounded-md transition-colors whitespace-nowrap ${activeTab === 'team' ? 'bg-brand-primary/10 text-brand-primary' : 'text-text-secondary hover:bg-bg-elevated hover:text-text-primary'}`}>Team & Roles</button>
          <button onClick={() => setActiveTab('leads')} className={`text-left px-3 py-2 text-sm font-semibold rounded-md transition-colors whitespace-nowrap ${activeTab === 'leads' ? 'bg-brand-primary/10 text-brand-primary' : 'text-text-secondary hover:bg-bg-elevated hover:text-text-primary'}`}>Leads & Sales</button>
          <button onClick={() => setActiveTab('storms')} className={`text-left px-3 py-2 text-sm font-semibold rounded-md transition-colors whitespace-nowrap ${activeTab === 'storms' ? 'bg-brand-primary/10 text-brand-primary' : 'text-text-secondary hover:bg-bg-elevated hover:text-text-primary'}`}>Storms</button>
          <button onClick={() => setActiveTab('field')} className={`text-left px-3 py-2 text-sm font-semibold rounded-md transition-colors whitespace-nowrap ${activeTab === 'field' ? 'bg-brand-primary/10 text-brand-primary' : 'text-text-secondary hover:bg-bg-elevated hover:text-text-primary'}`}>Field & GPS</button>
          <button onClick={() => setActiveTab('contacts')} className={`text-left px-3 py-2 text-sm font-semibold rounded-md transition-colors whitespace-nowrap ${activeTab === 'contacts' ? 'bg-brand-primary/10 text-brand-primary' : 'text-text-secondary hover:bg-bg-elevated hover:text-text-primary'}`}>Contact Enrichment</button>
          <button onClick={() => setActiveTab('comms')} className={`text-left px-3 py-2 text-sm font-semibold rounded-md transition-colors whitespace-nowrap ${activeTab === 'comms' ? 'bg-brand-primary/10 text-brand-primary' : 'text-text-secondary hover:bg-bg-elevated hover:text-text-primary'}`}>Communications</button>
          <button onClick={() => setActiveTab('ai')} className={`text-left px-3 py-2 text-sm font-semibold rounded-md transition-colors whitespace-nowrap ${activeTab === 'ai' ? 'bg-brand-primary/10 text-brand-primary' : 'text-text-secondary hover:bg-bg-elevated hover:text-text-primary'}`}>AI & Automation</button>
          <button onClick={() => setActiveTab('integrations')} className={`text-left px-3 py-2 text-sm font-semibold rounded-md transition-colors whitespace-nowrap ${activeTab === 'integrations' ? 'bg-brand-primary/10 text-brand-primary' : 'text-text-secondary hover:bg-bg-elevated hover:text-text-primary'}`}>Integrations</button>
          <button onClick={() => setActiveTab('compliance')} className={`text-left px-3 py-2 text-sm font-semibold rounded-md transition-colors whitespace-nowrap ${activeTab === 'compliance' ? 'bg-brand-primary/10 text-brand-primary' : 'text-text-secondary hover:bg-bg-elevated hover:text-text-primary'}`}>Security & Privacy</button>
          <button onClick={() => setActiveTab('health')} className={`text-left px-3 py-2 text-sm font-semibold rounded-md transition-colors whitespace-nowrap ${activeTab === 'health' ? 'bg-brand-primary/10 text-brand-primary' : 'text-text-secondary hover:bg-bg-elevated hover:text-text-primary'}`}>System Health</button>
        </div>

        <div className="flex-1 space-y-6">
          {membershipError && (
            <Card className="bg-warning-surface ring-1 ring-warning-border p-4">
              <p className="text-sm text-status-warning">Organization access error: {membershipError}</p>
            </Card>
          )}

          {activeTab === 'account' && (
            <>
              <SectionTitle>MY ACCOUNT</SectionTitle>
              <Card className="p-5 space-y-4">
                <div className="flex items-center gap-4 mb-4">
                  <div className="size-16 rounded-full bg-brand-primary/20 flex items-center justify-center text-brand-primary">
                    <User size={32} />
                  </div>
                  <div>
                    <p className="text-lg font-bold">{profile?.fullName || session.user.email}</p>
                    {profile?.fullName && <p className="text-sm text-text-secondary">{session.user.email}</p>}
                    <p className="text-sm text-brand-primary font-medium">{membership ? ROLE_LABEL[membership.role] ?? membership.role : 'No organization access'}</p>
                  </div>
                </div>
                <Field label="Full Name">
                  <TextInput value={localName} onChange={(e) => { setLocalName(e.target.value); setSaved(false) }} placeholder="Full name" />
                </Field>
                <Field label="Phone Number">
                  <TextInput value={localPhone} onChange={(e) => { setLocalPhone(e.target.value); setSaved(false) }} placeholder="Phone number" inputMode="tel" />
                </Field>
                <div className="pt-2">
                  <button type="button" onClick={() => void handleSaveProfile()} disabled={saving} className="bg-brand-primary px-4 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-60">
                    {saving ? 'Saving…' : 'Save Profile'}
                  </button>
                  {saved && <span className="ml-3 text-xs text-status-success">Profile saved.</span>}
                </div>
              </Card>

              <div className="mt-8 mb-2">
                <SectionTitle>AUTHENTICATION</SectionTitle>
              </div>
              <Card className="p-5">
                <AccountPanel />
              </Card>
            </>
          )}

          {activeTab === 'org' && (
            <>
              <SectionTitle>ORGANIZATION DETAILS</SectionTitle>
              <Card className="p-5 space-y-4">
                <div className="flex items-center gap-3 mb-4">
                  <Building2 className="text-brand-primary" size={24} />
                  <div>
                    <h3 className="text-lg font-bold">{membership?.organizationName || 'No Organization'}</h3>
                  </div>
                </div>
                {!membership ? (
                  <p className="text-[13px] text-status-warning">You are not attached to an active organization.</p>
                ) : (
                  <div className="space-y-4">
                    <Field label="Company Name"><TextInput value={membership.organizationName} readOnly className="opacity-70" /></Field>
                    <Field label="Timezone"><TextInput value="America/Chicago" readOnly className="opacity-70" /></Field>
                    <p className="text-xs text-text-muted mt-2">Only administrators can change organization details.</p>
                  </div>
                )}
              </Card>
            </>
          )}

          {activeTab === 'field' && (
            <>
              <SectionTitle>FIELD & GPS LOGIC</SectionTitle>
              <Card className="p-5 space-y-6">
                <div>
                  <h4 className="font-semibold mb-2">Location Source Configuration</h4>
                  <p className="text-sm text-text-secondary mb-4">Historical GPS rules have been recovered. Delta Ridge utilizes high-accuracy GPS by default, seamlessly failing over to low-accuracy GPS, and ultimately falling back to IP Geolocation via API if hardware is unavailable.</p>
                  
                  <div className="space-y-3">
                    <label className="flex items-center gap-3">
                      <input type="checkbox" checked readOnly className="rounded border-border-light text-brand-primary" />
                      <span className="text-sm font-medium">Use high-accuracy GPS when available</span>
                    </label>
                    <label className="flex items-center gap-3">
                      <input type="checkbox" checked readOnly className="rounded border-border-light text-brand-primary" />
                      <span className="text-sm font-medium">Enable first-party IP Geolocation fallback</span>
                    </label>
                    <label className="flex items-center gap-3">
                      <input type="checkbox" checked readOnly className="rounded border-border-light text-brand-primary" />
                      <span className="text-sm font-medium">Display location source (GPS vs IP) to reps</span>
                    </label>
                  </div>
                </div>

                <div className="border-t border-border-subtle pt-6">
                  <h4 className="font-semibold mb-2">Radius Defaults</h4>
                  <Field label="Default Search Radius">
                    <select className="w-full p-2.5 rounded-lg border border-border-subtle bg-bg-elevated text-sm">
                      <option>5 miles</option>
                      <option>10 miles</option>
                      <option selected>15 miles</option>
                      <option>20 miles</option>
                      <option>50 miles</option>
                    </select>
                  </Field>
                </div>
              </Card>
            </>
          )}

          {activeTab === 'contacts' && (
            <>
              <SectionTitle>CONTACT ENRICHMENT</SectionTitle>
              <Card className="p-5 space-y-6">
                <div>
                  <h4 className="font-semibold text-status-warning mb-2">Configuration Warning</h4>
                  <p className="text-sm text-text-secondary mb-4">
                    The previous "LexisNexis / Clearbit" provider labels were a placeholder and not actually powering phone lookups. 
                    Historical investigation confirms that on October 1, contact enrichment was powered by a custom Supabase Edge Function (`lookup-contact`) utilizing <strong>BatchData Property Search API</strong> and <strong>RealEstateAPI</strong>.
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="bg-bg-elevated p-4 rounded-lg border border-border-subtle">
                    <h5 className="font-semibold text-sm">BatchData API</h5>
                    <p className="text-xs text-text-secondary mt-1 mb-3">Primary provider for skip-tracing. Requires an active balance.</p>
                    <TextInput placeholder="Enter BatchData API Key" type="password" />
                  </div>

                  <div className="bg-bg-elevated p-4 rounded-lg border border-border-subtle">
                    <h5 className="font-semibold text-sm">RealEstateAPI</h5>
                    <p className="text-xs text-text-secondary mt-1 mb-3">Secondary fallback provider for skip-tracing.</p>
                    <TextInput placeholder="Enter RealEstateAPI Key" type="password" />
                  </div>
                </div>

                <div className="border-t border-border-subtle pt-4">
                  <p className="text-sm text-text-secondary">
                    Contact lookups will automatically report "PROVIDER_NOT_CONFIGURED" on lead cards until one of these keys is provided.
                  </p>
                </div>
              </Card>
            </>
          )}

          {activeTab === 'health' && (
            <>
              <SectionTitle>SYSTEM HEALTH DASHBOARD</SectionTitle>
              <p className="text-sm text-text-secondary mb-6">
                Health statuses are evaluated from actual real-world integration traffic flowing through your organization, not static credential checks.
              </p>
              <IntegrationHealthPanel organizationId={membership?.organizationId ?? null} />
            </>
          )}

          {['team', 'leads', 'storms', 'comms', 'ai', 'integrations', 'compliance'].includes(activeTab) && (
            <>
              <SectionTitle>{activeTab.toUpperCase()} SETTINGS</SectionTitle>
              <Card className="p-12 text-center">
                <p className="text-text-secondary text-sm">This specific configuration module is operational via backend API but UI controls are pending migration.</p>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
