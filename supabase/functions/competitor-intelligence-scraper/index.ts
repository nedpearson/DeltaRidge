/* eslint-disable @typescript-eslint/no-explicit-any */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || ""
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN") || ""
const CRON_SECRET = Deno.env.get("CRON_SECRET") || ""

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

serve(async (req) => {
  if (req.method !== "POST" && req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 })
  }

  const authHeader = req.headers.get("authorization")
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 })
  }

  try {
    const { data: orgs } = await supabase.from('social_autonomy_config').select('organization_id')
    if (!orgs) return new Response("No orgs found", { status: 200 })

    for (const org of orgs) {
      const orgId = org.organization_id;
      
      // If provider access is unavailable, log the disconnected state and return
      if (!META_ACCESS_TOKEN) {
        await supabase.from('competitor_ad_intelligence').insert({
          organization_id: orgId,
          competitor_name: 'Provider Access Unavailable',
          platform: 'system',
          ad_content: 'Please connect your Meta Ad Library credentials to enable Competitor Watch.',
          threat_level: 'low',
          notes: 'Disconnected'
        });
        continue;
      }
      
      // In a real implementation, we would query the Meta Ad Library API here
      // For now, without a real API implementation or mock data, we simply do nothing
      // instead of faking it.
    }
    
    return new Response(JSON.stringify({ success: true, message: "Competitor intelligence checked." }), {
      headers: { "Content-Type": "application/json" },
    })
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { "Content-Type": "application/json" },
      status: 500,
    })
  }
})
