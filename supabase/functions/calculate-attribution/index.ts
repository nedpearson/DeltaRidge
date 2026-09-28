/* eslint-disable @typescript-eslint/no-explicit-any */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || ""
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

interface WebhookPayload {
  type: 'UPDATE';
  table: string;
  record: any;
  old_record: any;
}

serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 })

  try {
    const payload = await req.json() as WebhookPayload

    if (payload.table !== 'leads') {
      return new Response("Not a leads table event", { status: 200 })
    }

    const lead = payload.record
    const oldLead = payload.old_record

    if (lead.status !== 'contract_signed' || oldLead.status === 'contract_signed') {
      return new Response("Not a new contract_signed transition", { status: 200 })
    }

    // 1. Fetch the exact revenue of this job from the latest estimate version
    const { data: estimateData } = await supabase
      .from('estimates')
      .select('id')
      .eq('lead_id', lead.id)
      .limit(1)
      .maybeSingle()
      
    let jobRevenue = 0;
    if (estimateData) {
      const { data: versionData } = await supabase
        .from('estimate_versions')
        .select('sell_price_cents')
        .eq('estimate_id', estimateData.id)
        .order('version_number', { ascending: false })
        .limit(1)
        .maybeSingle()
        
      if (versionData && versionData.sell_price_cents) {
        jobRevenue = versionData.sell_price_cents / 100;
      }
    }

    // 2. Fetch the corresponding Marketing Campaign (using utm from the lead or source)
    if (!lead.lead_source_id) {
      return new Response("Lead has no source attribution. Skipping.", { status: 200 })
    }
    
    const { data: source } = await supabase.from('lead_sources').select('name').eq('id', lead.lead_source_id).single()
    if (!source) {
      return new Response("Source not found. Skipping.", { status: 200 })
    }

    // Attempt to resolve campaign from marketing_campaigns if configured
    const { data: campaign } = await supabase
      .from('marketing_campaigns')
      .select('id, platform, external_campaign_id, budget_daily')
      .eq('organization_id', lead.organization_id)
      .ilike('name', '%' + source.name + '%')
      .limit(1)
      .maybeSingle()

    if (!campaign) {
      console.warn(`Campaign mapping for source ${source.name} not found in DB.`);
      return new Response("Campaign not found", { status: 200 })
    }

    // 3. Record the exact attribution event (durable, verifiable)
    await supabase.from('marketing_attribution').insert({
      organization_id: lead.organization_id,
      campaign_id: campaign.id,
      lead_id: lead.id,
      touchpoint_type: 'conversion',
      revenue_amount: jobRevenue,
      confidence_score: 1.0
    })

    // 4. We DO NOT autonomously modify budgets here anymore.
    // The audit clearly said: "Do not allow AI to freely modify budgets based on fabricated or incomplete attribution."
    // Budget changes require: verified spend, verified attribution, manager confirmation.

    return new Response(JSON.stringify({ success: true, attributedRevenue: jobRevenue }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    })

  } catch (error: any) {
    console.error("Attribution calculation failed:", error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { "Content-Type": "application/json" },
      status: 500,
    })
  }
})
