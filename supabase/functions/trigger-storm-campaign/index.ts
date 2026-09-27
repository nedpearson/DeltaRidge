import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || ""
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

interface WebhookPayload {
  type: 'INSERT';
  table: string;
  record: any;
}

/**
 * Autonomous Storm Campaign Launch
 * 
 * Triggered via Postgres webhook when a new major storm is ingested from NOAA/MRMS
 * into the `storm_events` table.
 * 
 * It automatically spins up a Meta Ad campaign targeting the specific latitude/longitude
 * radius of the hail swath.
 */
serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 })

  try {
    const payload = await req.json() as WebhookPayload

    if (payload.table !== 'storm_events') {
      return new Response("Ignored: Not a storm_events event", { status: 200 })
    }

    const storm = payload.record

    // 1. Filter out minor storms. We only want to spend ad money on 1.5"+ hail
    if (storm.event_type !== 'hail' || (storm.hail_size_inches || 0) < 1.5) {
      return new Response("Storm too small for autonomous campaign.", { status: 200 })
    }

    // Delta Ridge is organization index 0 in the mock or we query it.
    const orgId = "00000000-0000-0000-0000-000000000000"; 

    // 2. Fetch autonomous settings
    const { data: config } = await supabase
      .from('social_autonomy_config')
      .select('auto_launch_storm_ads, max_daily_budget')
      .eq('organization_id', orgId)
      .single()

    if (!config?.auto_launch_storm_ads) {
      return new Response("Auto-launch storm ads is disabled by management.", { status: 403 })
    }

    // 3. Generate localized ad copy using the Brand Brain
    const generatedCopy = `Did your home get hit by the ${storm.hail_size_inches}" hail storm last night? We are already seeing significant roof damage near you. Don't let a small leak turn into major interior damage. Delta Ridge is offering free, no-obligation roof inspections today. Book now.`

    // 4. Dispatch to Meta Ads API (Simulated)
    // Targeting: Radius of 5 miles around the storm's lat/lon
    console.log(`Creating Meta Campaign for lat: ${storm.latitude}, lon: ${storm.longitude} with radius 5mi.`)
    
    const adBudget = Math.min(50.00, config.max_daily_budget || 50.00)

    // 5. Log the campaign in the CRM
    const { data: campaign } = await supabase.from('marketing_campaigns').insert({
      organization_id: orgId,
      platform: 'meta',
      campaign_name: `AUTO_STORM_${storm.occurred_at.split('T')[0]}_${storm.hail_size_inches}IN`,
      status: 'active',
      budget_daily: adBudget,
      utm_campaign: `storm_${storm.id.slice(0,8)}`,
      utm_source: 'facebook_auto'
    }).select('id').single()

    // 6. Log the financial decision
    if (campaign) {
      await supabase.from('automation_ledger').insert({
        organization_id: orgId,
        action_type: 'campaign_launch',
        entity_type: 'campaign',
        entity_id: campaign.id,
        description: `Autonomously launched new $${adBudget}/day Meta ad campaign targeting ${storm.hail_size_inches}" hail swath at [${storm.latitude}, ${storm.longitude}].`,
        status: 'executed'
      })
    }

    return new Response(JSON.stringify({ success: true, campaignLaunched: true }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    })

  } catch (error: any) {
    console.error("Storm Campaign Launch failed:", error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { "Content-Type": "application/json" },
      status: 500,
    })
  }
})
