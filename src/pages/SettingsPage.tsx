import { useState, useEffect } from 'react';
import { getSupabase } from '@/lib/supabase';

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('organization');
  const [loading, setLoading] = useState(false);
  interface SettingsData { storm_settings: { wind_threshold: number; hail_threshold: number; enable_wind: boolean }; gps_settings: { enable_tracking: boolean; property_geofence_radius: number }; ai_settings: { autonomy_level: string; enable_sms: boolean; enable_voice: boolean } }
  const [settings, setSettings] = useState<SettingsData>({
    storm_settings: { wind_threshold: 60, hail_threshold: 1.0, enable_wind: true },
    gps_settings: { enable_tracking: true, property_geofence_radius: 100 },
    ai_settings: { autonomy_level: 'Assisted', enable_sms: true, enable_voice: false }
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
            ai_settings: data.ai_settings || settings.ai_settings
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
          ...settings
        });
      }
    }
    setLoading(false);
    // settings saved
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="bg-status-success/10 border border-status-success text-status-success p-4 rounded-lg flex justify-between items-center">
        <div>
          <h2 className="font-bold">System Readiness</h2>
          <p className="text-sm">READY: 11 | NEEDS ATTENTION: 0 | BLOCKED: 0</p>
        </div>
      </div>

      <div className="flex gap-8">
        <div className="w-64 space-y-2">
          {['organization', 'storms', 'gps', 'ai', 'integrations'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`w-full text-left px-4 py-2 rounded-md ${activeTab === tab ? 'bg-brand-primary text-white' : 'hover:bg-bg-card'}`}
            >
              {tab.toUpperCase()}
            </button>
          ))}
        </div>

        <div className="flex-1 bg-bg-card p-6 rounded-lg shadow-sm border border-border-light">
          {activeTab === 'storms' && (
            <div className="space-y-4">
              <h3 className="text-lg font-bold text-text-primary">Storm Configuration</h3>
              <div>
                <label className="block text-sm font-medium text-text-secondary">Wind Threshold (MPH)</label>
                <input
                  type="number"
                  value={settings.storm_settings.wind_threshold}
                  onChange={(e) => setSettings({...settings, storm_settings: {...settings.storm_settings, wind_threshold: parseInt(e.target.value)}})}
                  className="mt-1 block w-full rounded-md bg-bg-primary border-border-light text-text-primary"
                />
              </div>
            </div>
          )}

          {activeTab === 'ai' && (
            <div className="space-y-4">
              <h3 className="text-lg font-bold text-text-primary">AI Automation</h3>
              <div>
                <label className="block text-sm font-medium text-text-secondary">Autonomy Level</label>
                <select
                  value={settings.ai_settings.autonomy_level}
                  onChange={(e) => setSettings({...settings, ai_settings: {...settings.ai_settings, autonomy_level: e.target.value}})}
                  className="mt-1 block w-full rounded-md bg-bg-primary border-border-light text-text-primary"
                >
                  <option>Manual</option>
                  <option>Assisted</option>
                  <option>Guarded Autonomy</option>
                  <option>Autopilot</option>
                </select>
              </div>
            </div>
          )}

          {activeTab === 'gps' && (
            <div className="space-y-4">
              <h3 className="text-lg font-bold text-text-primary">Field & GPS</h3>
              <div>
                <label className="block text-sm font-medium text-text-secondary">Geofence Radius (meters)</label>
                <input
                  type="number"
                  value={settings.gps_settings.property_geofence_radius}
                  onChange={(e) => setSettings({...settings, gps_settings: {...settings.gps_settings, property_geofence_radius: parseInt(e.target.value)}})}
                  className="mt-1 block w-full rounded-md bg-bg-primary border-border-light text-text-primary"
                />
              </div>
            </div>
          )}

          <div className="mt-8">
            <button
              onClick={saveSettings}
              disabled={loading}
              className="bg-brand-primary text-white px-4 py-2 rounded-md font-medium"
            >
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}



