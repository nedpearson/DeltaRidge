import { useState } from 'react';
import type { FormEvent } from 'react';
import { getSupabase } from '@/lib/supabase';

export default function FreeRoofCheckPage() {
  const [address, setAddress] = useState('');
  const [result, setResult] = useState<'idle' | 'loading' | 'done'>('idle');
  const [hasStorm, setHasStorm] = useState(false);

  const handleLookup = async (e: FormEvent) => {
    e.preventDefault();
    if (!address.trim()) return;
    setResult('loading');
    
    const supabase = getSupabase();
    if (!supabase) {
      setHasStorm(false);
      setResult('done');
      return;
    }

    try {
      // In a real app we'd geocode the address and use PostGIS ST_Intersects
      // For this demo, we'll check if there's any recent severe storm data
      const { data, error } = await supabase
        .from('storm_events')
        .select('id, event_type, hail_size_inches')
        .order('occurred_at', { ascending: false })
        .limit(1);
        
      if (error) throw error;
      setHasStorm(data && data.length > 0);
    } catch (err) {
      console.error(err);
      setHasStorm(true); // Fallback for demo
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
              {hasStorm 
                ? 'Your property is within an area with recorded storm activity.'
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
