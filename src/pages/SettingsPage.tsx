/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import { Card, SectionTitle, TextInput, Button, Field } from '@/components/ui';
import { getSupabase } from '@/lib/supabase';

export default function SettingsPage() {
  const [openaiKey, setOpenaiKey] = useState('');
  const [metaKey, setMetaKey] = useState('');
  const [twilioKey, setTwilioKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setBusy(true);
    setError(null);
    setSuccess(false);
    
    try {
      // In a real production app, we would send these to a secure backend endpoint 
      // which would inject them into the vault or Edge Secrets. 
      // For this implementation, we will invoke a dedicated Edge Function to store them safely.
      const { error: invokeError } = await getSupabase()!.functions.invoke('store-api-keys', {
        body: { openaiKey, metaKey, twilioKey }
      });

      if (invokeError) throw invokeError;
      
      setSuccess(true);
      setOpenaiKey('');
      setMetaKey('');
      setTwilioKey('');
    } catch (err: any) {
      setError(err.message || 'Failed to save API keys');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-8 max-w-2xl mx-auto space-y-8 animate-fade-in">
      <div>
        <h1 className="text-2xl font-semibold text-text-primary tracking-tight">System Settings</h1>
        <p className="text-text-secondary mt-1">Configure external API credentials to enable real AI and network capabilities.</p>
      </div>

      <div className="space-y-6">
        <SectionTitle>API CREDENTIALS</SectionTitle>
        <Card className="space-y-4">
          <p className="text-sm text-text-secondary mb-4">
            These keys are required for the Dustin Content Engine, Voice AI Concierge, and automated social publishing.
          </p>
          
          <Field label="OpenAI API Key (gpt-4o)">
            <TextInput 
              type="password"
              placeholder="sk-..." 
              value={openaiKey} 
              onChange={(e) => setOpenaiKey(e.target.value)} 
            />
          </Field>

          <Field label="Meta Ads Encrypted Access Token">
            <TextInput 
              type="password"
              placeholder="EAA..." 
              value={metaKey} 
              onChange={(e) => setMetaKey(e.target.value)} 
            />
          </Field>

          <Field label="Twilio Auth Token">
            <TextInput 
              type="password"
              placeholder="Enter Twilio token..." 
              value={twilioKey} 
              onChange={(e) => setTwilioKey(e.target.value)} 
            />
          </Field>

          {error && <p className="text-sm text-status-critical">{error}</p>}
          {success && <p className="text-sm text-status-success">Keys successfully stored in Edge Secrets!</p>}

          <div className="pt-2">
            <Button 
              onClick={handleSave} 
              disabled={busy || (!openaiKey && !metaKey && !twilioKey)}
            >
              {busy ? 'Saving...' : 'Save Credentials to Cloud'}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}



