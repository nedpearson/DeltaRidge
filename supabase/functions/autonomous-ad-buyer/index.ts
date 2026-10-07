import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
// Paid promotion needs an approved ad set, creative, targeting, provider spend
// verification and a campaign budget. A campaign shell is not a delivered ad.
serve(req => new Response(JSON.stringify({ success: false, promoted_count: 0, error: 'Automatic paid promotion is disabled pending verified spend, attribution and manager-approved advertising configuration.' }), {
  status: req.method === 'POST' ? 409 : 405, headers: { 'Content-Type': 'application/json' }
}))
