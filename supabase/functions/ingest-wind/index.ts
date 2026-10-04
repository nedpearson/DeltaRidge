import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  const authHeader = req.headers.get('Authorization')
  const expectedAuth = 'Bearer ' + Deno.env.get('CRON_SECRET')
  if (authHeader !== expectedAuth) {
    return new Response('Unauthorized', { status: 401 })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response('Missing Supabase environment variables', { status: 500 })
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    const body = await req.json()
    const reports = body.reports

    if (!Array.isArray(reports)) {
       return new Response(JSON.stringify({ error: "Expected 'reports' array" }), { status: 400 })
    }

    const highWindReports = reports.filter(r => r.wind_speed_mph >= 60)
    let ingestedCount = 0;
    
    for (const report of highWindReports) {
      // 1. Insert into storm_events
      const { data: insertedEvent, error: insertError } = await supabase
        .from('storm_events')
        .upsert({
          provider: 'noaa',
          external_id: report.external_id,
          event_type: 'wind',
          occurred_at: report.occurred_at,
          wind_speed_mph: report.wind_speed_mph,
          magnitude_note: report.magnitude_note,
          location: `SRID=4326;POINT(${report.longitude} ${report.latitude})`,
          city: report.city,
          county_parish: report.county_parish,
          state: report.state,
          raw: report.raw
        }, { onConflict: 'provider,external_id', ignoreDuplicates: true })
        .select()
        .single()
      
      if (insertError) {
        if (insertError.code !== 'PGRST116') {
          await supabase.from('integration_health_logs').insert({
            integration_name: 'ingest-wind',
            status: 'failed',
            message: `Failed to insert storm event: ${insertError.message}`
          })
          continue;
        }
      }
      
      if (insertedEvent) {
         ingestedCount++;
         
         // 2. Geospatial Matching & Deduplication
         const { error: matchError } = await supabase.rpc('match_storm_properties', {
            p_storm_id: insertedEvent.id
         });
         
         if (matchError) {
            await supabase.from('integration_health_logs').insert({
              integration_name: 'ingest-wind',
              status: 'failed',
              message: `Failed to match storm properties: ${matchError.message}`
            })
         }
      }
    }

    await supabase.from('integration_health_logs').insert({
      integration_name: 'ingest-wind',
      status: 'success',
      message: `Successfully ingested ${ingestedCount} wind events >= 60 MPH`
    })

    return new Response(JSON.stringify({ success: true, ingested: ingestedCount }), { headers: { 'Content-Type': 'application/json' } })

  } catch (error: unknown) {
    await supabase.from('integration_health_logs').insert({
      integration_name: 'ingest-wind',
      status: 'failed',
      message: `Fatal error: ${error.message}`
    })
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
})
