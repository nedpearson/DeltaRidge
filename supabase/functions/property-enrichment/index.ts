import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
// Retired simulated endpoint. Real enrichment is implemented by lookup-property
// and lookup-contact. Never persist invented owners, permits or roof ages.
serve(req => new Response(req.method === 'OPTIONS' ? null : JSON.stringify({ success: false, error: 'This enrichment endpoint is unavailable. Use the configured property and contact providers.' }), {
  status: req.method === 'OPTIONS' ? 204 : 503,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
}))
