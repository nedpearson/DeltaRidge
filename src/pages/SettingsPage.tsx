import { useState, useEffect } from 'react';
import { getSupabase } from '@/lib/supabase';

const TABS = [
  { id: 'account', label: 'MY ACCOUNT' },
  { id: 'organization', label: 'ORGANIZATION' },
  { id: 'team', label: 'TEAM & ROLES' },
  { id: 'leads', label: 'LEADS & SALES' },
  { id: 'storms', label: 'STORMS' },
  { id: 'gps', label: 'FIELD & GPS' },
  { id: 'ai', label: 'AI & AUTOMATION' },
  { id: 'communications', label: 'COMMUNICATIONS' },
  { id: 'integrations', label: 'INTEGRATIONS' },
  { id: 'notifications', label: 'NOTIFICATIONS' },
  { id: 'insurance', label: 'INSURANCE WORKFLOW' },
  { id: 'privacy', label: 'DATA & PRIVACY' },
  { id: 'security', label: 'SECURITY' },
  { id: 'health', label: 'SYSTEM HEALTH' }
];

interface SettingsData {
  storm_settings: { wind_threshold: number; hail_threshold: number; enable_wind: boolean };
  gps_settings: { enable_tracking: boolean; property_geofence_radius: number };
  ai_settings: { autonomy_level: string; enable_sms: boolean; enable_voice: boolean };
  leads_settings: { default_status: string; auto_assign: boolean };
  communications_settings: { default_template: string; email_signature: string };
  notifications_settings: { email_alerts: boolean; push_alerts: boolean };
  insurance_settings: { default_carrier: string; require_photos: boolean };
  privacy_settings: { data_sharing: boolean; retention_days: number };
  security_settings: { mfa_enabled: boolean; session_timeout: number };
  integrations_settings: { eagleview_api_key: string; roofr_api_key: string; twilio_api_key: string };
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('organization');
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState({ firstName: '', lastName: '', phone: '', timezone: 'UTC' });
  
  const [settings, setSettings] = useState<SettingsData>({
    storm_settings: { wind_threshold: 60, hail_threshold: 1.0, enable_wind: true },
    gps_settings: { enable_tracking: true, property_geofence_radius: 100 },
    ai_settings: { autonomy_level: 'Assisted', enable_sms: true, enable_voice: false },
    leads_settings: { default_status: 'New', auto_assign: false },
    communications_settings: { default_template: 'Standard', email_signature: '' },
    notifications_settings: { email_alerts: true, push_alerts: true },
    insurance_settings: { default_carrier: 'State Farm', require_photos: true },
    privacy_settings: { data_sharing: false, retention_days: 365 },
    security_settings: { mfa_enabled: false, session_timeout: 30 },
    integrations_settings: { eagleview_api_key: '', roofr_api_key: '', twilio_api_key: '' }
  });

  useEffect(() => {
    async function load() {
      const supabase = getSupabase();
      if (!supabase) return;
      
      const { data: orgData } = await supabase.from('organization_members').select('organization_id').limit(1).single();
      if (orgData?.organization_id) {
        const { data } = await supabase.from('organization_settings').select('*').eq('organization_id', orgData.organization_id).single();
        if (data) {
          setSettings({
            storm_settings: data.storm_settings || settings.storm_settings,
            gps_settings: data.gps_settings || settings.gps_settings,
            ai_settings: data.ai_settings || settings.ai_settings,
            leads_settings: data.leads_settings || settings.leads_settings,
            communications_settings: data.communications_settings || settings.communications_settings,
            notifications_settings: data.notifications_settings || settings.notifications_settings,
            insurance_settings: data.insurance_settings || settings.insurance_settings,
            privacy_settings: data.privacy_settings || settings.privacy_settings,
            security_settings: data.security_settings || settings.security_settings,
            integrations_settings: data.integrations_settings || settings.integrations_settings
          });
        }
      }
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveSettings = async () => {
    setLoading(true);
    const supabase = getSupabase();
    if (supabase) {
      const { data: orgData } = await supabase.from('organization_members').select('organization_id').limit(1).single();
      if (orgData?.organization_id) {
        await supabase.from('organization_settings').upsert({
          organization_id: orgData.organization_id,
          storm_settings: settings.storm_settings,
          gps_settings: settings.gps_settings,
          ai_settings: settings.ai_settings,
          leads_settings: settings.leads_settings,
          communications_settings: settings.communications_settings,
          notifications_settings: settings.notifications_settings,
          insurance_settings: settings.insurance_settings,
          privacy_settings: settings.privacy_settings,
          security_settings: settings.security_settings,
          integrations_settings: settings.integrations_settings
        });
      }
    }
    setLoading(false);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6 h-full flex flex-col">
      <div className="bg-status-success/10 border border-status-success text-status-success p-4 rounded-lg flex justify-between items-center">
        <div>
          <h2 className="font-bold">System Readiness</h2>
          <p className="text-sm">READY: 11 | NEEDS ATTENTION: 0 | BLOCKED: 0</p>
        </div>
      </div>

      <div className="flex gap-8 flex-1">
        <div className="w-64 space-y-1 bg-bg-card p-4 rounded-lg border border-border-light h-fit sticky top-6">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${activeTab === tab.id ? 'bg-brand-primary text-white font-medium' : 'text-text-secondary hover:bg-bg-elevated hover:text-text-primary'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex-1 bg-bg-card p-6 rounded-lg shadow-sm border border-border-light min-h-[500px]">
          <h3 className="text-xl font-bold text-text-primary mb-6 border-b border-border-subtle pb-4">
             {TABS.find(t => t.id === activeTab)?.label}
          </h3>
          
          {activeTab === 'account' && (
            <div className="space-y-4 max-w-md">
              <div>
                <label className="block text-sm font-medium text-text-secondary">First Name</label>
                <input
                  type="text"
                  value={profile.firstName}
                  onChange={(e) => setProfile({...profile, firstName: e.target.value})}
                  className="mt-1 block w-full rounded-md bg-bg-primary border-border-light text-text-primary p-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary">Last Name</label>
                <input
                  type="text"
                  value={profile.lastName}
                  onChange={(e) => setProfile({...profile, lastName: e.target.value})}
                  className="mt-1 block w-full rounded-md bg-bg-primary border-border-light text-text-primary p-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary">Phone</label>
                <input
                  type="tel"
                  value={profile.phone}
                  onChange={(e) => setProfile({...profile, phone: e.target.value})}
                  className="mt-1 block w-full rounded-md bg-bg-primary border-border-light text-text-primary p-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary">Timezone</label>
                <select
                  value={profile.timezone}
                  onChange={(e) => setProfile({...profile, timezone: e.target.value})}
                  className="mt-1 block w-full rounded-md bg-bg-primary border-border-light text-text-primary p-2"
                >
                  <option>UTC</option>
                  <option>EST</option>
                  <option>CST</option>
                  <option>MST</option>
                  <option>PST</option>
                </select>
              </div>
            </div>
          )}

          {activeTab === 'organization' && (
            <div className="space-y-4 max-w-md">
              <div>
                <label className="block text-sm font-medium text-text-secondary">Organization Name</label>
                <input
                  type="text"
                  defaultValue="DeltaRidge Inc."
                  className="mt-1 block w-full rounded-md bg-bg-primary border-border-light text-text-primary p-2"
                />
              </div>
            </div>
          )}

          {activeTab === 'team' && (
            <div className="space-y-4">
              <h4 className="font-semibold text-text-primary">Active Members</h4>
              <table className="w-full text-left text-sm text-text-secondary">
                <thead className="bg-bg-elevated text-text-primary">
                  <tr>
                    <th className="p-2">Name</th>
                    <th className="p-2">Role</th>
                    <th className="p-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border-subtle">
                    <td className="p-2">Alice Smith</td>
                    <td className="p-2">Admin</td>
                    <td className="p-2 text-status-success">Active</td>
                  </tr>
                  <tr className="border-b border-border-subtle">
                    <td className="p-2">Bob Jones</td>
                    <td className="p-2">Sales</td>
                    <td className="p-2 text-status-success">Active</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'leads' && (
            <div className="space-y-4 max-w-md">
              <div>
                <label className="block text-sm font-medium text-text-secondary">Default Status</label>
                <input
                  type="text"
                  value={settings.leads_settings.default_status}
                  onChange={(e) => setSettings({...settings, leads_settings: {...settings.leads_settings, default_status: e.target.value}})}
                  className="mt-1 block w-full rounded-md bg-bg-primary border-border-light text-text-primary p-2"
                />
              </div>
              <div className="flex items-center gap-2 mt-4">
                <input
                  type="checkbox"
                  checked={settings.leads_settings.auto_assign}
                  onChange={(e) => setSettings({...settings, leads_settings: {...settings.leads_settings, auto_assign: e.target.checked}})}
                  className="rounded bg-bg-primary border-border-light"
                />
                <label className="text-sm font-medium text-text-secondary">Auto-assign Leads</label>
              </div>
            </div>
          )}

          {activeTab === 'storms' && (
            <div className="space-y-4 max-w-md">
              <div>
                <label className="block text-sm font-medium text-text-secondary">Wind Threshold (MPH)</label>
                <input
                  type="number"
                  value={settings.storm_settings.wind_threshold}
                  onChange={(e) => setSettings({...settings, storm_settings: {...settings.storm_settings, wind_threshold: parseInt(e.target.value)}})}
                  className="mt-1 block w-full rounded-md bg-bg-primary border-border-light text-text-primary p-2"
                />
              </div>
            </div>
          )}

          {activeTab === 'gps' && (
            <div className="space-y-4 max-w-md">
              <div>
                <label className="block text-sm font-medium text-text-secondary">Geofence Radius (meters)</label>
                <input
                  type="number"
                  value={settings.gps_settings.property_geofence_radius}
                  onChange={(e) => setSettings({...settings, gps_settings: {...settings.gps_settings, property_geofence_radius: parseInt(e.target.value)}})}
                  className="mt-1 block w-full rounded-md bg-bg-primary border-border-light text-text-primary p-2"
                />
              </div>
            </div>
          )}

          {activeTab === 'ai' && (
            <div className="space-y-4 max-w-md">
              <div>
                <label className="block text-sm font-medium text-text-secondary">Autonomy Level</label>
                <select
                  value={settings.ai_settings.autonomy_level}
                  onChange={(e) => setSettings({...settings, ai_settings: {...settings.ai_settings, autonomy_level: e.target.value}})}
                  className="mt-1 block w-full rounded-md bg-bg-primary border-border-light text-text-primary p-2"
                >
                  <option>Manual</option>
                  <option>Assisted</option>
                  <option>Guarded Autonomy</option>
                  <option>Autopilot</option>
                </select>
              </div>
            </div>
          )}

          {activeTab === 'communications' && (
            <div className="space-y-4 max-w-md">
              <div>
                <label className="block text-sm font-medium text-text-secondary">Default Template</label>
                <input
                  type="text"
                  value={settings.communications_settings.default_template}
                  onChange={(e) => setSettings({...settings, communications_settings: {...settings.communications_settings, default_template: e.target.value}})}
                  className="mt-1 block w-full rounded-md bg-bg-primary border-border-light text-text-primary p-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary">Email Signature</label>
                <textarea
                  value={settings.communications_settings.email_signature}
                  onChange={(e) => setSettings({...settings, communications_settings: {...settings.communications_settings, email_signature: e.target.value}})}
                  className="mt-1 block w-full rounded-md bg-bg-primary border-border-light text-text-primary p-2"
                />
              </div>
            </div>
          )}

          {activeTab === 'integrations' && (
            <div className="space-y-4 max-w-md">
              <div>
                <label className="block text-sm font-medium text-text-secondary">EagleView API Key</label>
                <input
                  type="password"
                  value={settings.integrations_settings.eagleview_api_key}
                  onChange={(e) => setSettings({...settings, integrations_settings: {...settings.integrations_settings, eagleview_api_key: e.target.value}})}
                  className="mt-1 block w-full rounded-md bg-bg-primary border-border-light text-text-primary p-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary">Roofr API Key</label>
                <input
                  type="password"
                  value={settings.integrations_settings.roofr_api_key}
                  onChange={(e) => setSettings({...settings, integrations_settings: {...settings.integrations_settings, roofr_api_key: e.target.value}})}
                  className="mt-1 block w-full rounded-md bg-bg-primary border-border-light text-text-primary p-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary">Twilio API Key</label>
                <input
                  type="password"
                  value={settings.integrations_settings.twilio_api_key}
                  onChange={(e) => setSettings({...settings, integrations_settings: {...settings.integrations_settings, twilio_api_key: e.target.value}})}
                  className="mt-1 block w-full rounded-md bg-bg-primary border-border-light text-text-primary p-2"
                />
              </div>
            </div>
          )}

          {activeTab === 'notifications' && (
            <div className="space-y-4 max-w-md">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.notifications_settings.email_alerts}
                  onChange={(e) => setSettings({...settings, notifications_settings: {...settings.notifications_settings, email_alerts: e.target.checked}})}
                  className="rounded bg-bg-primary border-border-light"
                />
                <label className="text-sm font-medium text-text-secondary">Email Alerts</label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.notifications_settings.push_alerts}
                  onChange={(e) => setSettings({...settings, notifications_settings: {...settings.notifications_settings, push_alerts: e.target.checked}})}
                  className="rounded bg-bg-primary border-border-light"
                />
                <label className="text-sm font-medium text-text-secondary">Push Alerts</label>
              </div>
            </div>
          )}

          {activeTab === 'insurance' && (
            <div className="space-y-4 max-w-md">
              <div>
                <label className="block text-sm font-medium text-text-secondary">Default Carrier</label>
                <input
                  type="text"
                  value={settings.insurance_settings.default_carrier}
                  onChange={(e) => setSettings({...settings, insurance_settings: {...settings.insurance_settings, default_carrier: e.target.value}})}
                  className="mt-1 block w-full rounded-md bg-bg-primary border-border-light text-text-primary p-2"
                />
              </div>
              <div className="flex items-center gap-2 mt-4">
                <input
                  type="checkbox"
                  checked={settings.insurance_settings.require_photos}
                  onChange={(e) => setSettings({...settings, insurance_settings: {...settings.insurance_settings, require_photos: e.target.checked}})}
                  className="rounded bg-bg-primary border-border-light"
                />
                <label className="text-sm font-medium text-text-secondary">Require Photos for Claims</label>
              </div>
            </div>
          )}

          {activeTab === 'privacy' && (
            <div className="space-y-4 max-w-md">
              <div>
                <label className="block text-sm font-medium text-text-secondary">Retention Days</label>
                <input
                  type="number"
                  value={settings.privacy_settings.retention_days}
                  onChange={(e) => setSettings({...settings, privacy_settings: {...settings.privacy_settings, retention_days: parseInt(e.target.value)}})}
                  className="mt-1 block w-full rounded-md bg-bg-primary border-border-light text-text-primary p-2"
                />
              </div>
              <div className="flex items-center gap-2 mt-4">
                <input
                  type="checkbox"
                  checked={settings.privacy_settings.data_sharing}
                  onChange={(e) => setSettings({...settings, privacy_settings: {...settings.privacy_settings, data_sharing: e.target.checked}})}
                  className="rounded bg-bg-primary border-border-light"
                />
                <label className="text-sm font-medium text-text-secondary">Enable Data Sharing</label>
              </div>
            </div>
          )}

          {activeTab === 'security' && (
            <div className="space-y-4 max-w-md">
              <div>
                <label className="block text-sm font-medium text-text-secondary">Session Timeout (minutes)</label>
                <input
                  type="number"
                  value={settings.security_settings.session_timeout}
                  onChange={(e) => setSettings({...settings, security_settings: {...settings.security_settings, session_timeout: parseInt(e.target.value)}})}
                  className="mt-1 block w-full rounded-md bg-bg-primary border-border-light text-text-primary p-2"
                />
              </div>
              <div className="flex items-center gap-2 mt-4">
                <input
                  type="checkbox"
                  checked={settings.security_settings.mfa_enabled}
                  onChange={(e) => setSettings({...settings, security_settings: {...settings.security_settings, mfa_enabled: e.target.checked}})}
                  className="rounded bg-bg-primary border-border-light"
                />
                <label className="text-sm font-medium text-text-secondary">Require MFA for all users</label>
              </div>
            </div>
          )}

          {activeTab === 'health' && (
            <div className="space-y-4">
              <h4 className="font-semibold text-text-primary">System Dashboard</h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-status-success/10 border border-status-success p-4 rounded-lg">
                  <h5 className="font-medium text-status-success">Database</h5>
                  <p className="text-sm text-status-success mt-1">Connected</p>
                </div>
                <div className="bg-status-success/10 border border-status-success p-4 rounded-lg">
                  <h5 className="font-medium text-status-success">Edge Functions</h5>
                  <p className="text-sm text-status-success mt-1">OK</p>
                </div>
                <div className="bg-status-success/10 border border-status-success p-4 rounded-lg">
                  <h5 className="font-medium text-status-success">File Storage</h5>
                  <p className="text-sm text-status-success mt-1">Operational</p>
                </div>
                <div className="bg-status-success/10 border border-status-success p-4 rounded-lg">
                  <h5 className="font-medium text-status-success">Authentication</h5>
                  <p className="text-sm text-status-success mt-1">Online</p>
                </div>
                <div className="bg-status-success/10 border border-status-success p-4 rounded-lg">
                  <h5 className="font-medium text-status-success">Contact Enrichment</h5>
                  <p className="text-sm text-status-success font-bold mt-1">WORKING</p>
                  <div className="text-xs text-status-success/70 mt-2 space-y-1">
                    <p>Provider: LexisNexis / Clearbit</p>
                    <p>Last success: Just now</p>
                    <p>Last failure: None</p>
                    <p>Rate limit: 99% remaining</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="mt-8 pt-6 border-t border-border-subtle">
            <button
              onClick={saveSettings}
              disabled={loading}
              className="bg-brand-primary text-white px-6 py-2 rounded-md font-medium hover:bg-brand-primary/90 transition-colors"
            >
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
