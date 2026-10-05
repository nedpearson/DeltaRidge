import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { property_id, lead_id } = body;

    if (!property_id && !lead_id) {
      throw new Error("Must provide property_id or lead_id");
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    let finalPropertyId = property_id;
    let finalLeadId = lead_id;

    if (!finalPropertyId && lead_id) {
      const { data: lead } = await supabaseClient.from('leads').select('property_id').eq('id', lead_id).single();
      if (lead) finalPropertyId = lead.property_id;
    }

    if (!finalLeadId && property_id) {
      // It's possible a property has no lead, don't strictly require it
      const { data: lead } = await supabaseClient.from('leads').select('id').eq('property_id', property_id).maybeSingle();
      if (lead) finalLeadId = lead.id;
    }

    if (!finalPropertyId) {
      throw new Error("Could not determine property_id");
    }

    // Fetch property data
    const { data: property } = await supabaseClient.from('properties').select('*').eq('id', finalPropertyId).single();
    
    // Simulate enrichment APIs
    const simulatedParishAssessor = {
      owner_name: "John Doe",
      assessed_value: 250000,
      year_built: 1995
    };

    const simulatedPermits = [
      { permit_type: "Roofing", issue_date: "2010-05-12", description: "Tear off and replace asphalt shingles" },
      { permit_type: "Electrical", issue_date: "2018-11-04", description: "Panel upgrade" }
    ];

    // Simulate Claude API call
    const currentYear = new Date().getFullYear();
    const claudeResult = {
      roof_age_years: currentYear - 2010, // 16
      last_roof_permit_date: "2010-05-12",
      opportunity_summary: "Home built in 1995. Roof is approximately 16 years old based on a 2010 permit. High likelihood of needing a replacement soon.",
      reasoning: "The parish records show year built 1995, but a roofing permit was pulled in 2010. Therefore, the roof is about 16 years old."
    };

    // Calculate a new opportunity score based on the extracted data.
    let newScore = 50;
    if (claudeResult.roof_age_years > 15) {
      newScore += 30;
    }

    // Update property
    await supabaseClient.from('properties').update({
      roof_age_years: claudeResult.roof_age_years,
      last_roof_permit_date: claudeResult.last_roof_permit_date,
      opportunity_summary: claudeResult.opportunity_summary,
      owner_name: simulatedParishAssessor.owner_name,
      owner_source: 'Parish Assessor Simulated'
    }).eq('id', finalPropertyId);

    // Update lead if exists
    if (finalLeadId) {
      await supabaseClient.from('leads').update({
        opportunity_score: newScore
      }).eq('id', finalLeadId);
    }

    // Insert into ai_intelligence_results
    await supabaseClient.from('ai_intelligence_results').insert({
      property_id: finalPropertyId,
      lead_id: finalLeadId,
      model: 'claude-3-opus-simulated',
      raw_input: { property, simulatedParishAssessor, simulatedPermits },
      raw_output: claudeResult,
      opportunity_summary: claudeResult.opportunity_summary,
      roof_age_years_extracted: claudeResult.roof_age_years,
      last_roof_permit_date_extracted: claudeResult.last_roof_permit_date
    });

    return new Response(JSON.stringify({ success: true, result: claudeResult }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
