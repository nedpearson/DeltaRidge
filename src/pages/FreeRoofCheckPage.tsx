import { useState } from 'react';
import type { FormEvent } from 'react';
import { getSupabase } from '@/lib/supabase';

export default function FreeRoofCheckPage() {
  const [address, setAddress] = useState('');
  const [result, setResult] = useState<'idle' | 'loading' | 'done'>('idle');
  const [assessmentStatus, setAssessmentStatus] = useState<'exposed' | 'clear' | 'unable_to_determine'>('clear');

  const handleLookup = async (e: FormEvent) => {
    e.preventDefault();
    if (!address.trim()) return;
    setResult('loading');
    
    const supabase = getSupabase();
    if (!supabase) {
      setAssessmentStatus('unable_to_determine');
      setResult('done');
      return;
    }

    try {
      // Hardcoded org ID for the public form demo, in reality driven by tenant domain
      const orgId = '00000000-0000-0000-0000-000000000000'; // Or rely on a public configuration

      const { data, error } = await supabase.rpc('check_storm_exposure_for_address', {
        org_id: orgId,
        search_address: address
      });
        
      if (error) throw error;
      
      setAssessmentStatus(data?.status || 'unable_to_determine');
    } catch (err) {
      console.error(err);
      setAssessmentStatus('unable_to_determine');
    }
    
    setResult('done');
  };

  return (
    <div className="min-h-screen bg-white flex flex-col items-center p-6 justify-center">
      <div className="max-w-md w-full">
        <h1 className="text-3xl font-bold mb-2 text-center text-slate-900">Free Roof Check</h1>
        <p className="text-slate-600 text-center mb-8">Enter your address to see if your property is in an area with recorded storm activity.</p>
        
        {result === 'idle' && (
          <form onSubmit={handleLookup} className="flex flex-col gap-4">
            <input 
              type="text" 
              className="border border-slate-300 rounded p-3 text-lg w-full"
              placeholder="Enter your property address"
              value={address}
              onChange={e => setAddress(e.target.value)}
            />
            <button type="submit" className="bg-blue-600 text-white font-bold py-3 px-4 rounded text-lg">
              Check Address
            </button>
          </form>
        )}

        {result === 'loading' && (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-slate-500 font-medium">Analyzing historical storm data...</p>
          </div>
        )}

        {result === 'done' && (
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-6 text-center">
            <h2 className="text-xl font-semibold mb-2">Assessment Complete</h2>
            <p className="text-slate-700 mb-6">
              {assessmentStatus === 'exposed'
                ? 'Your property is within an area with recorded storm activity.'
                : assessmentStatus === 'unable_to_determine'
                  ? 'We are unable to automatically determine storm exposure for this location right now, but a check is still recommended.'
                  : 'We checked your area. No severe recent storm activity was recorded, but a check is still recommended.'}
            </p>
            <button className="w-full bg-blue-600 text-white font-bold py-3 px-4 rounded text-lg mb-3">
              Schedule Free Inspection
            </button>
            <button 
              className="w-full bg-transparent text-slate-500 font-medium py-2"
              onClick={() => {
                setResult('idle');
                setAddress('');
              }}
            >
              Check another address
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
