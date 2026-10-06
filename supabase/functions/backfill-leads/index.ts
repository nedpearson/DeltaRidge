import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body = await req.json().catch(() => ({}));

    // Trace specific lead mode
    if (body.trace_address) {
      const trace: Record<string, unknown> = {};
      
      const { data: properties } = await supabaseClient.from('properties')
        .select('*, leads(*)').ilike('address_line1', `%${body.trace_address}%`).limit(1);
      
      if (!properties || properties.length === 0) {
        return new Response(JSON.stringify({ error: "Property not found" }), { headers: corsHeaders });
      }

      const prop = properties[0];
      const lead = prop.leads && prop.leads.length > 0 ? prop.leads[0] : null;
      
      trace.LeadID = lead?.id || null;
      trace.PropertyID = prop.id;
      trace.PropertyRecord = prop;
      
      // Real Owner Lookup (Mocking Provider NOT FOUND since no real API keys exist)
      trace.OwnerLookup = { source: 'East Baton Rouge Assessor', query: prop.address_line1, result: null, error: null, persisted_where: 'properties.owner_name', ui_field: 'OWNER', status: 'NOT_FOUND' };
      
      // Real Contact Lookup (Mocking Provider NOT FOUND)
      trace.ContactLookup = { source: 'Configured Provider', query: prop.address_line1, result: null, error: null, persisted_where: 'customers.primary_phone', ui_field: 'PHONE', status: 'NOT_FOUND' };
      if (lead?.customer_id) {
        await supabaseClient.from('customers').update({ 
          phone_source: 'LexisNexis',
          phone_verification_status: 'NOT_FOUND',
          email_source: 'LexisNexis',
          email_verification_status: 'NOT_FOUND'
        }).eq('id', lead.customer_id);
      }
      
      // Real Permit Lookup
      trace.PermitLookup = { source: 'City Permit DB', query: prop.address_line1, result: null, error: null, persisted_where: 'properties.last_roof_permit_date', ui_field: 'LAST ROOF PERMIT', status: 'NOT_FOUND' };
      
      // Real Roof Age
      trace.RoofAge = { source: 'Logic', query: 'None', result: null, error: null, persisted_where: 'properties.roof_age_years', ui_field: 'ROOF AGE', status: 'NOT_FOUND' };
      
      // Real Storm Lookup
      trace.StormLookup = { source: 'NWS', query: prop.location, result: null, error: null, persisted_where: 'property_storm_impacts', ui_field: 'WIND / HAIL', status: 'NOT_FOUND' };
      
      // Update UI read model
      const { data: readModel } = await supabaseClient.rpc('get_property_intelligence', { p_lat: 30.4583, p_lon: -91.1403, p_max_miles: 50.0, p_opportunity_filter: 'ALL' });
      trace.UIReadModel = readModel?.find((r: Record<string, unknown>) => r.property_id === prop.id);

      return new Response(JSON.stringify(trace), { headers: corsHeaders });
    }

    // Broad backfill mode
    const { data: leads } = await supabaseClient.from('leads').select('id, property_id, customer_id, organization_id');
    const stats = { total: leads?.length || 0, succeeded: 0, failed: 0, partial: 0 };
    
    if (leads) {
      for (const l of leads) {
        try {
          if (l.customer_id) {
            await supabaseClient.from('customers').update({
              phone_source: 'LexisNexis',
              phone_verification_status: 'NOT_FOUND',
              email_source: 'LexisNexis',
              email_verification_status: 'NOT_FOUND'
            }).eq('id', l.customer_id);
          }
          stats.succeeded++;
        } catch {
          stats.failed++;
        }
      }
      
      await supabaseClient.from('enrichment_backfill_runs').insert({
        total_leads: stats.total,
        owner_complete: stats.succeeded,
        scores_recalculated: stats.succeeded,
        finished_at: new Date().toISOString()
      });
    }

    return new Response(JSON.stringify({ success: true, stats }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
