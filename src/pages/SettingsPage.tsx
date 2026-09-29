import { Card, SectionTitle, TextInput, Field } from '@/components/ui'
import { ShieldAlert, CheckCircle2, Bot, Building2, User, KeyRound } from 'lucide-react'
import { useState } from 'react'
import { useSession } from '@/features/auth/session'
import AccountPanel from '@/features/auth/AccountPanel'

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<'profile' | 'org' | 'integrations' | 'ai'>('profile')
  const { session, membership, profile, updateProfile } = useSession()

  const [saving, setSaving] = useState(false)
  const [localName, setLocalName] = useState(profile?.fullName || '')
  const [localPhone, setLocalPhone] = useState(profile?.phone || '')

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
    await updateProfile({ fullName: localName, phone: localPhone })
    setSaving(false)
  }

  return (
    <div className="max-w-3xl pb-32">
      <div className="mt-4 mb-6 border-b border-border-subtle flex gap-6 overflow-x-auto no-scrollbar">
        <button onClick={() => setActiveTab('profile')} className={`pb-3 text-[13px] font-bold tracking-wide transition-colors ${activeTab === 'profile' ? 'text-brand-400 border-b-2 border-brand-400' : 'text-text-secondary hover:text-text-primary'}`}>PROFILE</button>
        <button onClick={() => setActiveTab('org')} className={`pb-3 text-[13px] font-bold tracking-wide transition-colors ${activeTab === 'org' ? 'text-brand-400 border-b-2 border-brand-400' : 'text-text-secondary hover:text-text-primary'}`}>ORGANIZATION</button>
        <button onClick={() => setActiveTab('integrations')} className={`pb-3 text-[13px] font-bold tracking-wide transition-colors ${activeTab === 'integrations' ? 'text-brand-400 border-b-2 border-brand-400' : 'text-text-secondary hover:text-text-primary'}`}>INTEGRATIONS</button>
        <button onClick={() => setActiveTab('ai')} className={`pb-3 text-[13px] font-bold tracking-wide transition-colors ${activeTab === 'ai' ? 'text-brand-400 border-b-2 border-brand-400' : 'text-text-secondary hover:text-text-primary'}`}>AI SETUP</button>
      </div>

      <div className="space-y-6">
        {activeTab === 'integrations' && (
          <>
            <SectionTitle hint="Production API keys are managed securely via Supabase Vault/deployment secrets, not in the browser.">
              INTEGRATION SECRETS
            </SectionTitle>
            <Card className="bg-bg-card p-5 ring-1 ring-border-subtle shadow-sm space-y-4">
              <div className="flex justify-between items-center border-b border-border-subtle pb-3">
                <div>
                  <p className="text-[13px] font-semibold text-text-primary flex items-center gap-2">
                    <KeyRound className="w-4 h-4 text-text-secondary" />
                    EagleView Connect
                  </p>
                  <p className="text-[11px] text-text-secondary mt-1">Automatically pull 3D roof models and measurements.</p>
                </div>
                <div className="flex items-center gap-2 text-status-success text-[12px] font-bold">
                  <CheckCircle2 className="w-4 h-4" /> Configured
                </div>
              </div>
              <div className="flex justify-between items-center border-b border-border-subtle pb-3">
                <div>
                  <p className="text-[13px] font-semibold text-text-primary flex items-center gap-2">
                    <KeyRound className="w-4 h-4 text-text-secondary" />
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
                    <KeyRound className="w-4 h-4 text-text-secondary" />
                    Twilio Auth Token
                  </p>
                  <p className="text-[11px] text-text-secondary mt-1">Used for SMS Follow-up and Referral links.</p>
                </div>
                <div className="flex items-center gap-2 text-status-error text-[12px] font-bold">
                  <ShieldAlert className="w-4 h-4" /> Not Configured
                </div>
              </div>
            </Card>
          </>
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
                  <p className="text-lg font-bold">{session.user.email}</p>
                  <p className="text-sm text-text-secondary">{membership?.role === 'admin' ? 'Administrator' : 'Field Representative'}</p>
                </div>
              </div>
              <Field label="Full Name">
                <TextInput 
                  value={localName} 
                  onChange={(e) => setLocalName(e.target.value)} 
                  onBlur={handleSaveProfile}
                  placeholder="e.g. John Doe"
                />
              </Field>
              <Field label="Phone Number">
                <TextInput 
                  value={localPhone} 
                  onChange={(e) => setLocalPhone(e.target.value)} 
                  onBlur={handleSaveProfile}
                  placeholder="e.g. 214-555-0199"
                />
              </Field>
              {saving && <p className="text-xs text-status-success animate-pulse">Saving changes...</p>}
            </Card>
          </>
        )}

        {activeTab === 'org' && (
          <>
            <SectionTitle>ORGANIZATION DETAILS</SectionTitle>
            <Card className="space-y-4 p-5">
              <div className="flex items-center gap-3 mb-2">
                <Building2 className="text-brand-400" size={24} />
                <h3 className="text-lg font-bold">{membership?.organizationName || 'No Organization'}</h3>
              </div>
              <p className="text-[13px] text-text-secondary mb-4">Your current access level: <span className="font-bold text-text-primary capitalize">{membership?.role || 'Guest'}</span></p>
              
              <Field label="Company Address">
                <TextInput defaultValue="123 Roofing Way, Dallas, TX 75201" disabled />
              </Field>
            </Card>
          </>
        )}

        {activeTab === 'ai' && (
          <>
            <SectionTitle>AI & AUTOMATION</SectionTitle>
            <Card className="bg-bg-card p-5 ring-1 ring-border-subtle shadow-sm space-y-4">
              <div className="flex justify-between items-center border-b border-border-subtle pb-3">
                <div>
                  <p className="text-[13px] font-semibold text-text-primary flex items-center gap-2">
                    <Bot className="w-4 h-4 text-brand-400" />
                    OpenAI API Key
                  </p>
                  <p className="text-[11px] text-text-secondary mt-1">Powers the Creative Studio, AI Concierge, and playbooks.</p>
                </div>
                <div className="flex items-center gap-2 text-status-success text-[12px] font-bold bg-status-success/10 px-2 py-1 rounded-full">
                  <CheckCircle2 className="w-4 h-4" /> Configured
                </div>
              </div>
              <div>
                <p className="text-[12px] text-text-secondary mt-2">Note: Key is securely injected via server-side deployment secrets and cannot be viewed in the browser.</p>
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  )
}
